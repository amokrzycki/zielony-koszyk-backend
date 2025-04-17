import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
import { Address } from '../entities/address.entity';
import { UpdateOrderDto } from '../dto/update-order.dto';

@Injectable()
export class OrderService {
  constructor(
    @InjectRepository(Order)
    private ordersRepository: Repository<Order>,
    private dataSource: DataSource,
    private readonly mailService: MailService,
    private invoiceService: InvoiceService,
  ) {}

  findAll(): Promise<Order[]> {
    return this.ordersRepository.find({
      relations: ['billingAddress', 'shippingAddress'],
    });
  }

  async findOrderByOrderId(id: number): Promise<Order> {
    return this.ordersRepository.findOne({
      where: { order_id: id },
      relations: ['billingAddress', 'shippingAddress'],
    });
  }

  findOrdersByUserId(id: string): Promise<Order[]> {
    return this.ordersRepository.findBy({ user_id: id });
  }

  async create(createOrderDto: CreateOrderDto): Promise<Order> {
    let savedOrder: Order;

    await this.dataSource.transaction(async (manager) => {
      const order = new Order();
      order.status = Statuses.NEW;
      order.order_type = createOrderDto.order_type;
      order.customer_email = createOrderDto.customer_email;

      if (createOrderDto.user_id) {
        const user = await manager.getRepository(User).findOne({
          where: { user_id: createOrderDto.user_id },
        });

        if (!user) {
          throw new NotFoundException(
            `User with ID ${createOrderDto.user_id} not found`,
          );
        }
        order.user_id = user.user_id;
        order.user = user;
      }

      await this.createAddresses(order, createOrderDto, manager);

      order.orderItems = await this.createOrderItems(
        order,
        createOrderDto.orderItems,
        manager,
      );

      order.orderItems.push(this.addDeliveryCost(order));

      order.total_amount = order.orderItems.reduce(
        (total, item) => total + item.price * item.quantity,
        0,
      );

      savedOrder = await manager.getRepository(Order).save(order);
    });

    // Generate invoice PDF after the transaction to have the order ID and save the invoice path
    const pdfBuffer = await this.invoiceService.generateInvoicePDF(
      savedOrder,
      createOrderDto.same_address,
    );

    const invoicePath = this.invoiceService.saveInvoiceToDisk(
      savedOrder,
      pdfBuffer,
    );

    savedOrder.invoice_path = `invoices/${invoicePath}`;

    await this.ordersRepository.save(savedOrder);

    await this.mailService.sendOrderConfirmation(savedOrder, pdfBuffer);

    return savedOrder;
  }

  async update(id: number, orderUpdate: UpdateOrderDto): Promise<Order> {
    const existingOrder = await this.ordersRepository.findOne({
      where: { order_id: id },
      relations: ['billingAddress', 'shippingAddress'],
    });

    if (!existingOrder) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    const updatedOrder = { ...existingOrder, ...orderUpdate };

    return this.ordersRepository.save(updatedOrder);
  }

  async remove(id: number): Promise<void> {
    await this.ordersRepository.delete(id);
  }

  private async createOrderItems(
    order: Order,
    orderDetails: CreateOrderDto['orderItems'],
    manager: EntityManager,
  ): Promise<OrderItem[]> {
    const orderItems: OrderItem[] = [];

    for (const detail of orderDetails) {
      const orderDetail = new OrderItem();
      const product = await manager.getRepository(Product).findOne({
        where: { product_id: detail.product_id },
      });

      if (!product) {
        throw new Error(`Product with ID ${detail.product_id} not found`);
      }

      if (product.stock_quantity < detail.quantity) {
        throw new ConflictException(
          `Insufficient stock for product ID ${detail.product_id}. Available: ${product.stock_quantity}, Requested: ${detail.quantity}`,
        );
      }

      product.stock_quantity -= detail.quantity;
      await manager.getRepository(Product).save(product);

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

  private addDeliveryCost(order: Order) {
    const shippingOrderDetail = new OrderItem();
    shippingOrderDetail.product_name = 'Dostawa';
    shippingOrderDetail.quantity = 1;
    shippingOrderDetail.price = 10;
    shippingOrderDetail.order_id = order.order_id;
    shippingOrderDetail.order = order;

    return shippingOrderDetail;
  }

  private async createAddresses(
    order: Order,
    createOrderDto: CreateOrderDto,
    manager: EntityManager,
  ): Promise<void> {
    if (createOrderDto.billingAddress) {
      const billingAddress = manager.getRepository(Address).create({
        ...createOrderDto.billingAddress,
      });

      if (order.user) {
        billingAddress.user = order.user;
      }

      if (createOrderDto.same_address) {
        order.billingAddress = await manager
          .getRepository(Address)
          .save(billingAddress);

        order.shippingAddress = await manager
          .getRepository(Address)
          .save(billingAddress);
      } else {
        order.billingAddress = await manager
          .getRepository(Address)
          .save(billingAddress);
      }
    }

    if (!createOrderDto.same_address) {
      const shippingAddress = manager.getRepository(Address).create({
        ...createOrderDto.shippingAddress,
      });

      if (order.user) {
        shippingAddress.user = order.user;
      }

      order.shippingAddress = await manager
        .getRepository(Address)
        .save(shippingAddress);
    }
  }
}
