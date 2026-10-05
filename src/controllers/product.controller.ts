import {
  BadRequestException,
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
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProductDto, UpdateProductDto } from '../dto/create-product.dto';
import { ProductResponseDto } from '../dto/product-response.dto';
import { RequestLocale } from '../i18n/request-locale.decorator';
import { Locale } from '../i18n/locale';
import { coded, ErrorCode } from '../errors/error-code';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiBearerAuth } from '@nestjs/swagger';
import { PageableProducts } from '../types/PageableProducts';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('products')
export class ProductController {
  constructor(private readonly productsService: ProductService) {}

  @Get()
  getAll(@RequestLocale() locale: Locale): Promise<ProductResponseDto[]> {
    return this.productsService.findAll(locale);
  }

  @Get('search')
  async searchProducts(
    @RequestLocale() locale: Locale,
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
      locale,
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

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':id/translations')
  getTranslations(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.findTranslations(id);
  }

  @Get(':id')
  getOne(
    @Param('id') id: string,
    @RequestLocale() locale: Locale,
  ): Promise<ProductResponseDto> {
    return this.productsService.findOne(+id, locale);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async create(
    @Body('product') productString: string,
    @RequestLocale() locale: Locale,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<ProductResponseDto> {
    if (!productString) {
      throw coded(
        NotFoundException,
        ErrorCode.PRODUCT_DATA_REQUIRED,
        'Product data not provided',
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(productString);
    } catch {
      throw new BadRequestException('Product data is not valid JSON');
    }
    const product = plainToInstance(CreateProductDto, raw);
    const errors = await validate(product);
    if (errors.length > 0) {
      throw new BadRequestException(
        errors.flatMap((error) => Object.values(error.constraints ?? {})),
      );
    }
    return this.productsService.create(product, locale, file);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() product: UpdateProductDto,
    @RequestLocale() locale: Locale,
  ): Promise<ProductResponseDto> {
    return this.productsService.update(id, product, locale);
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
    @RequestLocale() locale: Locale,
  ) {
    return await this.productsService.uploadProductImage(id, file, locale);
  }
}
