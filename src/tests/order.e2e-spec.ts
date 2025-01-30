import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { OrderType } from '../types/OrderType';
import { AppModule } from '../app.module';
import { CustomerType } from '../types/CustomerType';
import { AddressType } from '../enums/AddressType';
import { Statuses } from '../enums/Statuses';
import { CreateOrderItemDto } from '../dto/create-order-item.dto';
import { Address } from '../entities/address.entity';
import { CreateAddressDto } from '../dto/create-address.dto';
import { Reflector } from '@nestjs/core';

interface CreateOrderDto {
  order_type: OrderType;
  customer_email: string;
  orderItems: CreateOrderItemDto[];
  billingAddress?: CreateAddressDto;
  shippingAddress?: CreateAddressDto;
  same_address?: boolean;
  user_id?: string;
}

interface OrderResponse {
  status: Statuses;
  order_type: OrderType;
  customer_email: string;
  billingAddress: Address;
  shippingAddress: Address;
  orderItems: CreateOrderItemDto[];
  total_amount: string;
  user_id?: string;
  invoice_path: string;
  order_id: string;
  order_date: string;
}

describe('Scenariusz: Składanie zamówienia (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(
      new ClassSerializerInterceptor(app.get(Reflector)),
    );
    app.useGlobalPipes(new ValidationPipe({}));

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('Powinno utworzyć zamówienie prywatne (PRIVATE)', async () => {
    const newOrder: CreateOrderDto = {
      order_type: OrderType.PRIVATE,
      customer_email: 'amokrzycki96@gmail.com',
      orderItems: [
        { product_id: 1, quantity: 2, price: 10 },
        { product_id: 2, quantity: 1, price: 20 },
      ],
      billingAddress: {
        first_name: 'Jan',
        last_name: 'Kowalski',
        company_name: '',
        nip: '',
        phone: '+48123123123',
        street: 'Kwiatowa',
        city: 'Warszawa',
        zip: '00-123',
        building_number: '10',
        flat_number: '',
        type: AddressType.BILLING,
        customer_type: CustomerType.PERSON,
        default: false,
      },
      shippingAddress: {
        first_name: 'Jan',
        last_name: 'Kowalski',
        company_name: '',
        nip: '',
        phone: '+48123123123',
        street: 'Kwiatowa',
        city: 'Warszawa',
        zip: '00-123',
        building_number: '10',
        flat_number: '',
        type: AddressType.DELIVERY,
        customer_type: CustomerType.PERSON,
        default: false,
      },
      same_address: true,
    };

    const response = await request(app.getHttpServer())
      .post('/orders')
      .send(newOrder);

    expect(response.status).toBe(201);
    const responseBody = response.body as OrderResponse;
    expect(responseBody).toHaveProperty('order_id');
    expect(responseBody.order_type).toBe(OrderType.PRIVATE);
    expect(responseBody.customer_email).toBe(newOrder.customer_email);
    expect(responseBody.orderItems).toHaveLength(
      newOrder.orderItems.length + 1,
    );
  });

  it('Nie powinno utworzyć zamówienia z niepoprawnym body', async () => {
    const newOrder = {
      order_type: OrderType.PRIVATE,
      orderItems: [],
    };

    const response = await request(app.getHttpServer())
      .post('/orders')
      .send(newOrder);

    expect(response.status).toBe(400);
  });

  it('Powinno utworzyć zamówienie firmowe (COMPANY) z NIP', async () => {
    const companyOrder: CreateOrderDto = {
      order_type: OrderType.COMPANY,
      customer_email: 'amokrzycki96@gmail.com',
      billingAddress: {
        first_name: '',
        last_name: '',
        company_name: 'Firma XYZ',
        nip: '1111111111',
        phone: '+48123123123',
        street: 'Dostawcza',
        city: 'Kraków',
        zip: '30-123',
        building_number: '22',
        flat_number: '',
        type: AddressType.BILLING,
        customer_type: CustomerType.COMPANY,
        default: false,
      },
      shippingAddress: {
        first_name: 'Jan',
        last_name: 'Kowalski',
        company_name: '',
        nip: '',
        phone: '+48123123123',
        street: 'Dostawcza',
        city: 'Kraków',
        zip: '30-123',
        building_number: '22',
        flat_number: '',
        type: AddressType.DELIVERY,
        customer_type: CustomerType.PERSON,
        default: false,
      },
      same_address: false,
      orderItems: [{ product_id: 3, quantity: 5, price: 100 }],
    };

    const response = await request(app.getHttpServer())
      .post('/orders')
      .send(companyOrder);

    expect(response.status).toBe(201);
    const responseBody = response.body as OrderResponse;
    expect(responseBody.order_type).toBe(OrderType.COMPANY);
    expect(responseBody.billingAddress.nip).toBe(
      companyOrder.billingAddress.nip,
    );
  });
});
