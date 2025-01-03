import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProductsService } from '../services/products.service';
import { Products } from '../entities/products.entity';
import { CreateProductDto } from '../dto/create-product.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiBearerAuth } from '@nestjs/swagger';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  getAll(): Promise<Products[]> {
    return this.productsService.findAll();
  }

  @Get('search/:category')
  getByCategory(
    @Param('category') category: string,
    @Query('name') name?: string,
  ): Promise<Products[]> {
    if (!name) {
      return this.productsService.findByCategory(category);
    }
    return this.productsService.findLikeNameInCategory(category, name);
  }

  @Get('search')
  getLikeName(@Query('name') name?: string): Promise<Products[]> {
    if (!name) {
      return this.productsService.findAll();
    }
    return this.productsService.findLikeName(name);
  }

  @Get(':id')
  getOne(@Param('id') id: string): Promise<Products> {
    return this.productsService.findOne(+id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() product: CreateProductDto): Promise<Products> {
    return this.productsService.create(product);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() product: Partial<Products>,
  ): Promise<Products> {
    return this.productsService.update(+id, product);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.productsService.remove(+id);
  }
}
