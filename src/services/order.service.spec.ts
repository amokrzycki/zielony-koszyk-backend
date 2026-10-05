import { DataSource } from 'typeorm';
import { OrderService } from './order.service';
import { MailService } from './mail.service';
import { InvoiceService } from './invoice.service';
import { Order } from '../entities/order.entity';
import { Product } from '../entities/product.entity';
import { ProductTranslation } from '../entities/product-translation.entity';
import { Address } from '../entities/address.entity';
import { OrderItemType } from '../enums/OrderItemType';
import { Locale } from '../i18n/locale';
import { OrderType } from '../types/OrderType';
import { CreateOrderDto } from '../dto/create-order.dto';
import { address } from '../tests/support/order-fixtures';

const TRANSLATIONS = [
  { product_id: 1, locale: 'pl', name: 'Banan' },
  { product_id: 1, locale: 'en', name: 'Banana' },
  { product_id: 2, locale: 'pl', name: 'Tylko po polsku' },
] as ProductTranslation[];

const harness = () => {
  const saved: Order[] = [];
  const repositories = new Map<unknown, unknown>([
    [
      Product,
      {
        findOne: jest.fn(({ where }: { where: { product_id: number } }) =>
          Promise.resolve({
            product_id: where.product_id,
            stock_quantity: 10,
          }),
        ),
        save: jest.fn((product: Product) => Promise.resolve(product)),
      },
    ],
    [
      ProductTranslation,
      {
        findBy: jest.fn(({ product_id }: { product_id: number }) =>
          Promise.resolve(
            TRANSLATIONS.filter((t) => t.product_id === product_id),
          ),
        ),
      },
    ],
    [
      Address,
      {
        create: jest.fn((value: Address) => value),
        save: jest.fn((value: Address) => Promise.resolve(value)),
      },
    ],
    [
      Order,
      {
        save: jest.fn((order: Order) => {
          saved.push(order);
          return Promise.resolve(order);
        }),
      },
    ],
  ]);
  const manager = {
    getRepository: (entity: unknown) => repositories.get(entity),
  };
  const dataSource = {
    transaction: (run: (m: typeof manager) => Promise<void>) => run(manager),
  } as unknown as DataSource;
  const ordersRepository = { save: jest.fn() };
  const invoiceService = {
    generateInvoicePDF: jest
      .fn<Promise<Buffer>, [Order, boolean]>()
      .mockResolvedValue(Buffer.from('pdf')),
    saveInvoiceToDisk: jest.fn().mockReturnValue('invoice.pdf'),
  };
  const mailService = {
    sendOrderConfirmation: jest.fn<Promise<void>, [Order, Buffer]>(),
  };
  const service = new OrderService(
    ordersRepository as never,
    dataSource,
    mailService as unknown as MailService,
    invoiceService as unknown as InvoiceService,
  );
  return { service, saved, invoiceService, mailService };
};

const dto = (productIds: number[]): CreateOrderDto => ({
  order_type: OrderType.PRIVATE,
  customer_email: 'jan@example.com',
  same_address: true,
  billingAddress: address(),
  orderItems: productIds.map((product_id) => ({
    product_id,
    quantity: 2,
    price: 6.5,
  })),
});

describe('OrderService localization', () => {
  it.each<[Locale, string, string]>([
    ['pl', 'Banan', 'Dostawa'],
    ['en', 'Banana', 'Delivery'],
  ])(
    'stores the order locale and snapshots names in it (%s)',
    async (locale, productName, deliveryName) => {
      const { service, saved, invoiceService, mailService } = harness();

      const order = await service.create(dto([1]), locale);

      expect(saved[0].locale).toBe(locale);
      const [product, delivery] = order.orderItems;
      expect(product).toMatchObject({
        item_type: OrderItemType.PRODUCT,
        product_name: productName,
      });
      expect(delivery).toMatchObject({
        item_type: OrderItemType.DELIVERY,
        product_name: deliveryName,
      });
      // Invoice and e-mail receive the persisted order, which carries its own locale.
      expect(invoiceService.generateInvoicePDF.mock.calls[0][0]).toMatchObject({
        locale,
      });
      expect(mailService.sendOrderConfirmation.mock.calls[0][0]).toMatchObject({
        locale,
      });
    },
  );

  it('falls back to the Polish name when the product has no translation in the order language', async () => {
    const { service } = harness();

    const order = await service.create(dto([2]), 'en');

    expect(order.orderItems[0].product_name).toBe('Tylko po polsku');
  });
});
