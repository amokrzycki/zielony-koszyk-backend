import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ProductsService } from '../services/products.service';
import { Product } from '../entities/product.entity';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  getAll(): Promise<Product[]> {
    return this.productsService.findAll();
  }

  @Get('search/:category')
  getByCategory(
    @Param('category') category: string,
    @Query('name') name?: string,
  ): Promise<Product[]> {
    if (!name) {
      return this.productsService.findByCategory(category);
    }
    return this.productsService.findLikeNameInCategory(category, name);
  }

  @Get('search')
  getLikeName(@Query('name') name?: string): Promise<Product[]> {
    if (!name) {
      return this.productsService.findAll();
    }
    return this.productsService.findLikeName(name);
  }

  @Get(':id')
  getOne(@Param('id') id: string): Promise<Product> {
    return this.productsService.findOne(+id);
  }

  @Post()
  create(@Body() product: Partial<Product>): Promise<Product> {
    return this.productsService.create(product);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() product: Partial<Product>,
  ): Promise<Product> {
    return this.productsService.update(+id, product);
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.productsService.remove(+id);
  }
}
