import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Orders } from '../entities/orders.entity';
import { CreateOrderDto } from '../dto/create-order.dto';
import { Users } from '../entities/users.entity';
import { Products } from '../entities/products.entity';
import { Statuses } from '../enums/Statuses';
import { MailService } from './mail.service';
import { OrderItems } from '../entities/order-items.entity';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Orders)
    private ordersRepository: Repository<Orders>,
    @InjectRepository(Users)
    private usersRepository: Repository<Users>,
    @InjectRepository(Products)
    private productsRepository: Repository<Products>,
    private dataSource: DataSource,
    private readonly mailService: MailService,
  ) {}

  findAll(): Promise<Orders[]> {
    return this.ordersRepository.find();
  }

  async findOrderByOrderId(id: number): Promise<Orders> {
    return this.ordersRepository.findOneBy({ order_id: id });
  }

  findOrdersByUserId(id: string): Promise<Orders[]> {
    return this.ordersRepository.findBy({ user_id: id });
  }

  async create(createOrderDto: CreateOrderDto): Promise<Orders> {
    let savedOrder: Orders;

    await this.dataSource.transaction(async (manager) => {
      const order = new Orders();

      if (createOrderDto.user_id) {
        const user = await manager.getRepository(Users).findOne({
          where: { user_id: createOrderDto.user_id },
        });

        if (!user) {
          throw new Error(`User with ID ${createOrderDto.user_id} not found`);
        }
        order.user_id = user.user_id;
        order.user = user;
      }

      order.customer_name = createOrderDto.customer_name;
      order.customer_email = createOrderDto.customer_email;
      order.customer_phone = createOrderDto.customer_phone;
      order.customer_address = createOrderDto.customer_address;
      order.status = createOrderDto.status as Statuses;

      order.orderItems = [];

      for (const detail of createOrderDto.orderDetails) {
        const orderDetail = new OrderItems();
        const product = await manager.getRepository(Products).findOne({
          where: { product_id: detail.productId },
        });

        if (!product) {
          throw new Error(`Product with ID ${detail.productId} not found`);
        }

        orderDetail.product = product;
        orderDetail.product_name = product.name;
        orderDetail.quantity = detail.quantity;
        orderDetail.price = detail.price;
        orderDetail.order_id = order.order_id;
        orderDetail.order = order;

        order.orderItems.push(orderDetail);
      }

      // TODO: REWORK DELIVERY FEATURE
      // TODO: Revert total amount calculation

      const shippingOrderDetail = new OrderItems();
      shippingOrderDetail.product_name = 'Dostawa';
      shippingOrderDetail.quantity = 1;
      shippingOrderDetail.price = 10;
      shippingOrderDetail.order_id = order.order_id;
      shippingOrderDetail.order = order;
      order.orderItems.push(shippingOrderDetail);

      savedOrder = await manager.getRepository(Orders).save(order);
    });

    try {
      await this.mailService.sendOrderConfirmation(savedOrder);
    } catch (error) {
      console.error('Error sending order confirmation email:', error);
    }

    return savedOrder;
  }

  async update(id: number, order: Partial<Orders>): Promise<Orders> {
    await this.ordersRepository.update(id, order);
    return this.ordersRepository.findOneBy({ order_id: id });
  }

  async remove(id: number): Promise<void> {
    await this.ordersRepository.delete(id);
  }
}
