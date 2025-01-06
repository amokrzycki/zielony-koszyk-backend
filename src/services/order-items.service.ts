import { Injectable, NotFoundException } from '@nestjs/common';
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

  async update(id: number, partial: Partial<OrderItems>): Promise<OrderItems> {
    const existing = await this.orderItemsRepository.findOne({
      where: { order_item_id: id },
      relations: ['order'],
    });

    if (!existing) {
      throw new NotFoundException(`OrderItem with ID ${id} not found`);
    }

    Object.assign(existing, partial);

    return await this.orderItemsRepository.save(existing);
  }

  async remove(id: number): Promise<void> {
    const existing = await this.orderItemsRepository.findOne({
      where: { order_item_id: id },
      relations: ['order'],
    });

    if (!existing) {
      throw new NotFoundException(`OrderItem with ID ${id} not found`);
    }

    await this.orderItemsRepository.remove(existing);
  }
}
