import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ProductService } from '../services/product.service';
import { Product } from '../entities/product.entity';
import { CreateProductDto } from '../dto/create-product.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiBearerAuth } from '@nestjs/swagger';
import { PageableProducts } from '../types/PageableProducts';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('products')
export class ProductController {
  constructor(private readonly productsService: ProductService) {}

  @Get()
  getAll(): Promise<Product[]> {
    return this.productsService.findAll();
  }

  @Get('search')
  async searchProducts(
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('priceMin') priceMin?: string,
    @Query('priceMax') priceMax?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('orderBy') orderBy?: string,
    @Query('orderDir') orderDir?: 'ASC' | 'DESC',
  ): Promise<PageableProducts> {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limit = pageSize ? parseInt(pageSize, 10) : 10;
    const minPrice = priceMin ? parseFloat(priceMin) : undefined;
    const maxPrice = priceMax ? parseFloat(priceMax) : undefined;
    const direction = orderDir?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    const validPage = isNaN(pageNum) || pageNum < 1 ? 1 : pageNum;
    const validLimit = isNaN(limit) || limit < 1 ? 10 : limit;

    return await this.productsService.search({
      search,
      category,
      priceMin: minPrice,
      priceMax: maxPrice,
      page: validPage,
      pageSize: validLimit,
      orderBy,
      orderDir: direction,
    });
  }

  @Get(':id')
  getOne(@Param('id') id: string): Promise<Product> {
    return this.productsService.findOne(+id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  create(
    @Body('product') productString: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<Product> {
    if (!productString) {
      throw new NotFoundException('Product data not provided');
    }

    const product = JSON.parse(productString) as CreateProductDto;
    return this.productsService.create(product, file);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() product: Partial<Product>,
  ): Promise<Product> {
    return this.productsService.update(+id, product);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.productsService.remove(+id);
  }

  @Post(':id/image')
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return await this.productsService.uploadProductImage(id, file);
  }
}
