import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderItem } from '../entities/order-item.entity';
import { AddOrderItemsDto } from '../dto/add-order-items.dto';
import { Order } from '../entities/order.entity';
import { ProductTranslation } from '../entities/product-translation.entity';
import { OrderItemType } from '../enums/OrderItemType';
import { pickTranslation } from '../i18n/translate';
import { coded, ErrorCode } from '../errors/error-code';

@Injectable()
export class OrderItemService {
  constructor(
    @InjectRepository(OrderItem)
    private orderItemsRepository: Repository<OrderItem>,
    @InjectRepository(Order)
    private ordersRepository: Repository<Order>,
    @InjectRepository(ProductTranslation)
    private translationsRepository: Repository<ProductTranslation>,
  ) {}

  findAll(): Promise<OrderItem[]> {
    return this.orderItemsRepository.find();
  }

  findByOrderId(id: number): Promise<OrderItem[]> {
    return this.orderItemsRepository.findBy({ order_id: id });
  }

  /** Adds product lines to existing orders; each name snapshot is taken in that order's language. */
  async create(items: AddOrderItemsDto[]): Promise<OrderItem[]> {
    const orderItems: OrderItem[] = [];

    for (const item of items) {
      const order = await this.ordersRepository.findOneBy({
        order_id: item.order_id,
      });
      if (!order) {
        throw coded(
          NotFoundException,
          ErrorCode.ORDER_NOT_FOUND,
          `Order with ID ${item.order_id} not found`,
        );
      }
      const translations = await this.translationsRepository.findBy({
        product_id: item.product_id,
      });
      orderItems.push(
        this.orderItemsRepository.create({
          order_id: order.order_id,
          product_id: item.product_id,
          item_type: OrderItemType.PRODUCT,
          product_name:
            (pickTranslation(translations, order.locale) ?? translations[0])
              ?.name ?? '',
          quantity: item.quantity,
          price: item.price,
        }),
      );
    }

    return this.orderItemsRepository.save(orderItems);
  }

  async update(id: number, partial: Partial<OrderItem>): Promise<OrderItem> {
    const existing = await this.orderItemsRepository.findOne({
      where: { order_item_id: id },
      relations: { order: true },
    });

    if (!existing) {
      throw coded(
        NotFoundException,
        ErrorCode.ORDER_ITEM_NOT_FOUND,
        `OrderItem with ID ${id} not found`,
      );
    }

    Object.assign(existing, partial);

    return await this.orderItemsRepository.save(existing);
  }

  async remove(id: number): Promise<void> {
    const existing = await this.orderItemsRepository.findOne({
      where: { order_item_id: id },
      relations: { order: true },
    });

    if (!existing) {
      throw coded(
        NotFoundException,
        ErrorCode.ORDER_ITEM_NOT_FOUND,
        `OrderItem with ID ${id} not found`,
      );
    }

    await this.orderItemsRepository.remove(existing);
  }
}
