import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Products } from '../entities/products.entity';
import { ProductsService } from '../services/products.service';
import { ProductsController } from '../controllers/products.controller';
import { ProductsSeedService } from '../seeds/products-seed.service';

@Module({
  imports: [TypeOrmModule.forFeature([Products])],
  providers: [ProductsService, ProductsSeedService],
  controllers: [ProductsController],
  exports: [ProductsSeedService],
})
export class ProductsModule {}
