import { Address } from '../../entities/address.entity';
import { OrderItem } from '../../entities/order-item.entity';
import { Order } from '../../entities/order.entity';
import { OrderItemType } from '../../enums/OrderItemType';
import { Statuses } from '../../enums/Statuses';
import { Locale } from '../../i18n/locale';
import { OrderType } from '../../types/OrderType';

export const address = (overrides: Partial<Address> = {}): Address =>
  ({
    first_name: 'Jan',
    last_name: 'Kowalski',
    phone: '+48123123123',
    street: 'Kwiatowa',
    building_number: '10',
    city: 'Warszawa',
    zip: '00-123',
    ...overrides,
  }) as Address;

export const order = (locale: Locale): Order =>
  ({
    order_id: 7,
    locale,
    order_type: OrderType.PRIVATE,
    status: Statuses.NEW,
    customer_email: 'jan@example.com',
    order_date: new Date('2026-03-05T12:30:00Z'),
    total_amount: 1234.5,
    billingAddress: address(),
    shippingAddress: address(),
    orderItems: [
      {
        item_type: OrderItemType.PRODUCT,
        product_name: locale === 'en' ? 'Banana' : 'Banan',
        quantity: 2,
        price: 6.5,
      },
      {
        item_type: OrderItemType.DELIVERY,
        product_name: locale === 'en' ? 'Delivery' : 'Dostawa',
        quantity: 1,
        price: 10,
      },
    ] as OrderItem[],
  }) as Order;
