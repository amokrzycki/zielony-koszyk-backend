/* eslint-disable @typescript-eslint/no-require-imports -- `import x = require()` is what works without esModuleInterop, like the other e2e specs need */
import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { AppModule } from '../app.module';
import { OrderType } from '../types/OrderType';
import { OrderItemType } from '../enums/OrderItemType';
import { CustomerType } from '../types/CustomerType';
import { AddressType } from '../enums/AddressType';
import { InvoiceService } from '../services/invoice.service';

// uuid 14 ships ESM only, which ts-jest cannot load here (the other e2e specs fail on this too); only image upload uses it.
jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

interface ProductBody {
  product_id: number;
  name: string;
  description: string;
  category: string;
  translations?: unknown;
}
interface SearchBody {
  data: ProductBody[];
  totalCount: number;
}
interface OrderBody {
  order_id: number;
  locale: string;
  orderItems: {
    order_item_id: number;
    product_name: string;
    item_type: OrderItemType;
  }[];
}

/** Needs a database with the localization migration applied and the seeded admin (see products.e2e-spec.ts). */
describe('Localization (e2e)', () => {
  let app: INestApplication;
  let token: string;
  // Unique per run so repeated runs against one database never see each other's products.
  const tag = `Zq${Date.now()}`;
  const ids: Record<string, number> = {};
  const orderIds: number[] = [];

  const api = () =>
    request(app.getHttpServer() as Parameters<typeof request>[0]);
  const asAdmin = (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  const createProduct = async (
    key: string,
    pl: string,
    en: string,
    price = 5,
  ) => {
    const response = await asAdmin(api().post('/products'))
      .field(
        'product',
        JSON.stringify({
          price,
          category: 'owoce',
          stock_quantity: 100,
          translations: {
            pl: { name: `${pl} ${tag}`, description: `Opis ${pl}` },
            en: { name: `${en} ${tag}`, description: `About ${en}` },
          },
        }),
      )
      .expect(201);
    ids[key] = (response.body as ProductBody).product_id;
  };

  beforeAll(async () => {
    // Keep test invoices off the disk (and independent of the invoices/ directory's permissions).
    jest
      .spyOn(InvoiceService.prototype, 'saveInvoiceToDisk')
      .mockReturnValue('invoice.pdf');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(
      new ClassSerializerInterceptor(app.get(Reflector)),
    );
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    const login = await api()
      .post('/auth/login')
      .send({ email: 'admin@admin.pl', password: 'hasloadmina!1' });
    token = (login.body as { access_token: string }).access_token;

    // Polish alphabetical order (Ć < Z) deliberately differs from English (Apple < Zebra-ish).
    await createProduct('cherry', 'Wiśnia', 'Cherry', 3);
    await createProduct('apple', 'Zielone jabłko', 'Apple', 4);
    await createProduct('banana', 'Ananas', 'Banana', 5);
  });

  afterAll(async () => {
    for (const id of orderIds) {
      await asAdmin(api().delete(`/orders/${id}`));
    }
    for (const id of Object.values(ids)) {
      await asAdmin(api().delete(`/products/${id}`));
    }
    await app.close();
  });

  it('returns a localized DTO without leaking translation storage', async () => {
    const en = await api()
      .get(`/products/${ids.banana}`)
      .set('Accept-Language', 'en-US,en;q=0.9')
      .expect(200);
    const pl = await api().get(`/products/${ids.banana}`).expect(200);

    const enBody = en.body as ProductBody;
    expect(enBody.name).toBe(`Banana ${tag}`);
    expect(enBody.description).toBe('About Banana');
    expect(enBody).not.toHaveProperty('translations');
    expect((pl.body as ProductBody).name).toBe(`Ananas ${tag}`);
  });

  it('searches in the active language only', async () => {
    const searchEn = await api()
      .get('/products/search')
      .query({ search: `banana ${tag}` })
      .set('Accept-Language', 'en')
      .expect(200);
    const searchPlWithEnglishTerm = await api()
      .get('/products/search')
      .query({ search: `banana ${tag}` })
      .set('Accept-Language', 'pl')
      .expect(200);
    const searchPl = await api()
      .get('/products/search')
      .query({ search: `ananas ${tag}` })
      .set('Accept-Language', 'pl')
      .expect(200);

    expect((searchEn.body as SearchBody).data.map((p) => p.product_id)).toEqual(
      [ids.banana],
    );
    expect((searchPlWithEnglishTerm.body as SearchBody).totalCount).toBe(0);
    expect((searchPl.body as SearchBody).data[0].name).toBe(`Ananas ${tag}`);
  });

  it('sorts by the active language name', async () => {
    const names = async (locale: string, orderDir: string) => {
      const response = await api()
        .get('/products/search')
        .query({ search: tag, orderBy: 'name', orderDir, pageSize: 10 })
        .set('Accept-Language', locale)
        .expect(200);
      return (response.body as SearchBody).data.map((p) =>
        p.name.replace(` ${tag}`, ''),
      );
    };

    expect(await names('en', 'ASC')).toEqual(['Apple', 'Banana', 'Cherry']);
    expect(await names('pl', 'ASC')).toEqual([
      'Ananas',
      'Wiśnia',
      'Zielone jabłko',
    ]);
    expect(await names('en', 'DESC')).toEqual(['Cherry', 'Banana', 'Apple']);
  });

  it('falls back to Polish text when a translation is missing', async () => {
    const response = await api()
      .get(`/products/${ids.cherry}`)
      .set('Accept-Language', 'en')
      .expect(200);
    expect((response.body as ProductBody).name).toBe(`Cherry ${tag}`);

    // Remove only the English row, as a legacy product would lack it.
    const dataSource = app.get<import('typeorm').DataSource>(
      (await import('typeorm')).DataSource,
    );
    await dataSource.query(
      `DELETE FROM "zielonykoszyk"."product_translations" WHERE product_id = $1 AND locale = 'en'`,
      [ids.cherry],
    );

    const fallback = await api()
      .get(`/products/${ids.cherry}`)
      .set('Accept-Language', 'en')
      .expect(200);
    expect((fallback.body as ProductBody).name).toBe(`Wiśnia ${tag}`);
    const searched = await api()
      .get('/products/search')
      .query({ search: `wiśnia ${tag}` })
      .set('Accept-Language', 'en')
      .expect(200);
    expect((searched.body as SearchBody).totalCount).toBe(1);
  });

  it('lets an admin read and update every language, and rejects unknown products with a code', async () => {
    const translations = await asAdmin(
      api().get(`/products/${ids.apple}/translations`),
    ).expect(200);
    expect(translations.body).toEqual({
      pl: { name: `Zielone jabłko ${tag}`, description: 'Opis Zielone jabłko' },
      en: { name: `Apple ${tag}`, description: 'About Apple' },
    });

    await asAdmin(api().put(`/products/${ids.apple}`))
      .send({
        translations: {
          en: { name: `Green apple ${tag}`, description: 'Crisp' },
        },
      })
      .expect(200);
    const after = await api()
      .get(`/products/${ids.apple}`)
      .set('Accept-Language', 'en');
    expect((after.body as ProductBody).name).toBe(`Green apple ${tag}`);

    const missing = await asAdmin(
      api().get('/products/99999999/translations'),
    ).expect(404);
    expect(missing.body).toMatchObject({
      statusCode: 404,
      code: 'PRODUCT_NOT_FOUND',
    });
  });

  it('captures the order language and snapshots localized names', async () => {
    const address = (type: AddressType) => ({
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
      type,
      customer_type: CustomerType.PERSON,
      default: false,
    });
    const placeOrder = (locale: string) =>
      api()
        .post('/orders')
        .set('Accept-Language', locale)
        .send({
          order_type: OrderType.PRIVATE,
          customer_email: 'localization-test@example.com',
          orderItems: [{ product_id: ids.banana, quantity: 1, price: 5 }],
          billingAddress: address(AddressType.BILLING),
          shippingAddress: address(AddressType.DELIVERY),
          same_address: true,
        })
        .expect(201);

    const english = (await placeOrder('en-GB')).body as OrderBody;
    const polish = (await placeOrder('pl')).body as OrderBody;
    orderIds.push(english.order_id, polish.order_id);

    expect(english.locale).toBe('en');
    expect(english.orderItems.map((i) => i.product_name)).toEqual([
      `Banana ${tag}`,
      'Delivery',
    ]);
    expect(english.orderItems.map((i) => i.item_type)).toEqual([
      OrderItemType.PRODUCT,
      OrderItemType.DELIVERY,
    ]);
    expect(polish.locale).toBe('pl');
    expect(polish.orderItems[1].product_name).toBe('Dostawa');

    // Editing the catalog later must not rewrite the historical order, and a Polish request must not either.
    await asAdmin(api().put(`/products/${ids.banana}`)).send({
      translations: { en: { name: 'Renamed', description: 'x' } },
    });
    const items = await asAdmin(
      api()
        .get(`/order-items/${english.order_id}`)
        .set('Accept-Language', 'pl'),
    ).expect(200);
    expect((items.body as OrderBody['orderItems'])[0].product_name).toBe(
      `Banana ${tag}`,
    );
    const stored = await asAdmin(
      api()
        .get(`/orders/order/${english.order_id}`)
        .set('Accept-Language', 'pl'),
    ).expect(200);
    expect((stored.body as OrderBody).locale).toBe('en');
  });

  it('snapshots in the order language when an admin adds items to an existing order', async () => {
    const created = await api()
      .post('/orders')
      .set('Accept-Language', 'en')
      .send({
        order_type: OrderType.PRIVATE,
        customer_email: 'localization-test@example.com',
        orderItems: [{ product_id: ids.apple, quantity: 1, price: 4 }],
        billingAddress: {
          first_name: 'Jan',
          last_name: 'Kowalski',
          phone: '+48123123123',
          street: 'Kwiatowa',
          city: 'Warszawa',
          zip: '00-123',
          building_number: '10',
          type: AddressType.BILLING,
          customer_type: CustomerType.PERSON,
        },
        same_address: true,
      })
      .expect(201);
    const orderId = (created.body as OrderBody).order_id;
    orderIds.push(orderId);

    // Admin UI runs in Polish and (wrongly) sends a Polish name; the server ignores it.
    const added = await asAdmin(
      api().post('/order-items').set('Accept-Language', 'pl'),
    )
      .send([
        {
          order_id: orderId,
          product_id: ids.banana,
          product_name: 'Ananas po polsku',
          quantity: 2,
          price: 5,
        },
      ])
      .expect(201);

    expect((added.body as OrderBody['orderItems'])[0].product_name).toBe(
      'Renamed',
    );
  });
});
