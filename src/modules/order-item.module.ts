import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderItemService } from '../services/order-item.service';
import { OrderItemController } from '../controllers/order-item.controller';
import { OrderModule } from './order.module';
import { ProductModule } from './product.module';
import { OrderItem } from '../entities/order-item.entity';
import { Order } from '../entities/order.entity';
import { OrderItemSubscriber } from '../subscribers/order-item.subscriber';
import { DataSource } from 'typeorm';

@Module({
  imports: [
    TypeOrmModule.forFeature([OrderItem, Order]),
    OrderModule,
    ProductModule,
  ],
  controllers: [OrderItemController],
  providers: [
    OrderItemService,
    {
      provide: 'ORDER_ITEM_SUBSCRIBER',
      useFactory: (dataSource: DataSource) => {
        const subscriber = new OrderItemSubscriber(dataSource);
        dataSource.subscribers.push(subscriber);
        return subscriber;
      },
      inject: [DataSource],
    },
  ],
})
export class OrderItemModule {}
