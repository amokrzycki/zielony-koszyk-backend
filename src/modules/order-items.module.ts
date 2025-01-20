import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderItemsService } from '../services/order-items.service';
import { OrderItemsController } from '../controllers/order-items.controller';
import { OrdersModule } from './orders.module';
import { ProductsModule } from './products.module';
import { OrderItem } from '../entities/order-item.entity';
import { Order } from '../entities/order.entity';
import { OrderItemsSubscriber } from '../subscribers/order-items.subscriber';
import { DataSource } from 'typeorm';

@Module({
  imports: [
    TypeOrmModule.forFeature([OrderItem, Order]),
    OrdersModule,
    ProductsModule,
  ],
  controllers: [OrderItemsController],
  providers: [
    OrderItemsService,
    {
      provide: 'ORDER_ITEM_SUBSCRIBER',
      useFactory: (dataSource: DataSource) => {
        const subscriber = new OrderItemsSubscriber(dataSource);
        dataSource.subscribers.push(subscriber);
        return subscriber;
      },
      inject: [DataSource],
    },
  ],
})
export class OrderItemsModule {}
