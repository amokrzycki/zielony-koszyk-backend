import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from '../entities/product.entity';
import { ProductService } from '../services/product.service';
import { ProductController } from '../controllers/product.controller';
import { ProductsSeedService } from '../seeds/products-seed.service';

@Module({
  imports: [TypeOrmModule.forFeature([Product])],
  providers: [ProductService, ProductsSeedService],
  controllers: [ProductController],
  exports: [ProductsSeedService],
})
export class ProductModule {}
