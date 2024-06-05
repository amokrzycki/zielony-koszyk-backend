import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderDetail } from '../entities/order-detail.entity';

@Injectable()
export class OrderDetailsService {
  constructor(
    @InjectRepository(OrderDetail)
    private orderDetailsRepository: Repository<OrderDetail>,
  ) {}

  findAll(): Promise<OrderDetail[]> {
    return this.orderDetailsRepository.find();
  }

  findOne(id: number): Promise<OrderDetail> {
    return this.orderDetailsRepository.findOneBy({ order_detail_id: id });
  }

  create(orderDetail: Partial<OrderDetail>): Promise<OrderDetail> {
    const newOrderDetail = this.orderDetailsRepository.create(orderDetail);
    return this.orderDetailsRepository.save(newOrderDetail);
  }

  async update(
    id: number,
    orderDetail: Partial<OrderDetail>,
  ): Promise<OrderDetail> {
    await this.orderDetailsRepository.update(id, orderDetail);
    return this.orderDetailsRepository.findOneBy({ order_detail_id: id });
  }

  async remove(id: number): Promise<void> {
    await this.orderDetailsRepository.delete(id);
  }
}
