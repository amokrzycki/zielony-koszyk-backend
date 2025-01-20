import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Order } from '../entities/order.entity';
import { CreateOrderDto } from '../dto/create-order.dto';
import { User } from '../entities/user.entity';
import { Product } from '../entities/product.entity';
import { Statuses } from '../enums/Statuses';
import { MailService } from './mail.service';
import { OrderItem } from '../entities/order-item.entity';
import { InvoiceService } from './invoice.service';

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
    private invoiceService: InvoiceService,
  ) {}

  findAll(): Promise<Order[]> {
    return this.ordersRepository.find();
  }

  async findOrderByOrderId(id: number): Promise<Order> {
    return this.ordersRepository.findOneBy({ order_id: id });
  }

  findOrdersByUserId(id: string): Promise<Order[]> {
    return this.ordersRepository.findBy({ user_id: id });
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
        order.user = user;
      }

      order.customer_name = createOrderDto.customer_name;
      order.customer_email = createOrderDto.customer_email;
      order.customer_phone = createOrderDto.customer_phone;
      order.customer_address = createOrderDto.customer_address;
      order.status = Statuses.NEW;
      order.order_type = createOrderDto.order_type;

      if (createOrderDto.order_type === 'COMPANY') {
        order.nip = createOrderDto.nip;
      }

      order.orderItems = await this.createOrderItems(
        order,
        createOrderDto.orderDetails,
        manager,
      );

      const shippingOrderDetail = new OrderItem();
      shippingOrderDetail.product_name = 'Dostawa';
      shippingOrderDetail.quantity = 1;
      shippingOrderDetail.price = 10;
      shippingOrderDetail.order_id = order.order_id;
      shippingOrderDetail.order = order;
      order.orderItems.push(shippingOrderDetail);

      order.total_amount = order.orderItems.reduce(
        (total, item) => total + item.price * item.quantity,
        0,
      );

      savedOrder = await manager.getRepository(Order).save(order);
    });

    // Generate invoice PDF after the transaction to have the order ID and save the invoice path
    const pdfBuffer = await this.invoiceService.generateInvoicePDF(savedOrder);

    const invoicePath = await this.invoiceService.saveInvoiceToDisk(
      savedOrder,
      pdfBuffer,
    );

    savedOrder.invoice_path = `invoices/${invoicePath}`;

    await this.ordersRepository.save(savedOrder);

    try {
      await this.mailService.sendOrderConfirmation(savedOrder, pdfBuffer);
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

  private async createOrderItems(
    order: Order,
    orderDetails: CreateOrderDto['orderDetails'],
    manager: EntityManager,
  ): Promise<OrderItem[]> {
    const orderItems: OrderItem[] = [];

    for (const detail of orderDetails) {
      const orderDetail = new OrderItem();
      const product = await manager.getRepository(Product).findOne({
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

      orderItems.push(orderDetail);
    }

    return orderItems;
  }
}
