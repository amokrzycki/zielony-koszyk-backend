import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderItems } from '../entities/order-items.entity';

@Injectable()
export class OrderItemsService {
  constructor(
    @InjectRepository(OrderItems)
    private orderItemsRepository: Repository<OrderItems>,
  ) {}

  findAll(): Promise<OrderItems[]> {
    return this.orderItemsRepository.find();
  }

  findByOrderId(id: number): Promise<OrderItems[]> {
    return this.orderItemsRepository.findBy({ order_id: id });
  }

  create(orderItem: Partial<OrderItems>): Promise<OrderItems> {
    const newOrderItem = this.orderItemsRepository.create(orderItem);
    return this.orderItemsRepository.save(newOrderItem);
  }

  async update(
    id: number,
    orderItem: Partial<OrderItems>,
  ): Promise<OrderItems> {
    await this.orderItemsRepository.update(id, orderItem);
    return this.orderItemsRepository.findOneBy({ order_item_id: id });
  }

  async remove(id: number): Promise<void> {
    await this.orderItemsRepository.delete(id);
  }
}
