import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Order } from '../entities/order.entity';
import { CreateOrderDto } from '../dto/create-order.dto';
import { OrderDetail } from '../entities/order-detail.entity';
import { User } from '../entities/user.entity';
import { Product } from '../entities/product.entity';
import { Statuses } from '../enums/Statuses';
import { MailService } from './mail.service';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private ordersRepository: Repository<Order>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Product)
    private productsRepository: Repository<Product>,
    private dataSource: DataSource,
    private readonly mailService: MailService,
  ) {}

  findAll(): Promise<Order[]> {
    return this.ordersRepository.find();
  }

  findOne(id: number): Promise<Order> {
    return this.ordersRepository.findOneBy({ order_id: id });
  }

  async create(createOrderDto: CreateOrderDto): Promise<Order> {
    let savedOrder: Order;

    await this.dataSource.transaction(async (manager) => {
      const order = new Order();

      if (createOrderDto.user_id) {
        const user = await manager.getRepository(User).findOne({
          where: { user_id: createOrderDto.user_id },
        });

        if (!user) {
          throw new Error(`User with ID ${createOrderDto.user_id} not found`);
        }

        order.user_id = user.user_id;
      }

      order.customer_name = createOrderDto.customer_name;
      order.customer_email = createOrderDto.customer_email;
      order.customer_phone = createOrderDto.customer_phone;
      order.customer_address = createOrderDto.customer_address;
      order.status = createOrderDto.status as Statuses;

      let totalAmount = 0;

      order.orderDetails = [];

      for (const detail of createOrderDto.orderDetails) {
        const orderDetail = new OrderDetail();
        const product = await manager.getRepository(Product).findOne({
          where: { product_id: detail.productId },
        });

        if (!product) {
          throw new Error(`Product with ID ${detail.productId} not found`);
        }
        orderDetail.product = product;
        orderDetail.quantity = detail.quantity;
        orderDetail.price = detail.price;
        orderDetail.order = order;

        totalAmount += detail.quantity * detail.price;

        order.orderDetails.push(orderDetail);
      }

      order.total_amount = totalAmount;

      savedOrder = await manager.getRepository(Order).save(order);
    });

    try {
      await this.mailService.sendOrderConfirmation(savedOrder);
    } catch (error) {
      console.error('Error sending order confirmation email:', error);
    }

    return savedOrder;
  }

  async update(id: number, order: Partial<Order>): Promise<Order> {
    await this.ordersRepository.update(id, order);
    return this.ordersRepository.findOneBy({ order_id: id });
  }

  async remove(id: number): Promise<void> {
    await this.ordersRepository.delete(id);
  }
}
