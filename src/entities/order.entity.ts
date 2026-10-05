import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
  OneToMany,
} from 'typeorm';
import { User } from './user.entity';
import { Statuses } from '../enums/Statuses';
import { OrderItem } from './order-item.entity';
import { Exclude } from 'class-transformer';
import { OrderType } from '../types/OrderType';
import { Address } from './address.entity';
import { DEFAULT_LOCALE, LOCALES, Locale } from '../i18n/locale';
import { LOCALE_ENUM_NAME } from './product-translation.entity';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn()
  order_id: number;

  @Column('char', { length: 36, nullable: true })
  user_id: string;

  @Column({ type: 'enum', enum: OrderType, default: OrderType.PRIVATE })
  order_type: OrderType;

  @ManyToOne(() => User)
  @Exclude()
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column()
  customer_email: string;

  @ManyToOne(() => Address, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'billing_address_id' })
  billingAddress: Address;

  @ManyToOne(() => Address, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'shipping_address_id' })
  shippingAddress: Address;

  @CreateDateColumn()
  order_date: Date;

  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  total_amount: number;

  @Column({ type: 'enum', enum: Statuses })
  status: Statuses;

  /** Language the order was placed in; invoices and e-mails for this order always use it. */
  @Column({
    type: 'enum',
    enum: [...LOCALES],
    enumName: LOCALE_ENUM_NAME,
    default: DEFAULT_LOCALE,
  })
  locale: Locale;

  @OneToMany(() => OrderItem, (orderItem) => orderItem.order, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  orderItems: OrderItem[];

  @Column({ nullable: true })
  invoice_path: string;
}
