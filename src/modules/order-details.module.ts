import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderDetail } from '../entities/order-detail.entity';
import { OrderDetailsService } from '../services/order-details.service';
import { OrderDetailsController } from '../controllers/order-details.controller';
import { OrdersModule } from './orders.module';
import { ProductsModule } from './products.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([OrderDetail]),
    OrdersModule,
    ProductsModule,
  ],
  providers: [OrderDetailsService],
  controllers: [OrderDetailsController],
})
export class OrderDetailsModule {}
