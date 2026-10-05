import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
} from 'typeorm';
import { Order } from './order.entity';
import { Product } from './product.entity';
import { Exclude } from 'class-transformer';
import { OrderItemType } from '../enums/OrderItemType';

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn()
  order_item_id: number;

  @Column()
  order_id: number;

  @ManyToOne(() => Order, (order) => order.orderItems, {
    onDelete: 'CASCADE',
  })
  @Exclude()
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({ nullable: true })
  product_id: number;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'product_id' })
  product: Relation<Product>;

  @Column({ type: 'enum', enum: OrderItemType, default: OrderItemType.PRODUCT })
  item_type: OrderItemType;

  /** Snapshot in the order's language, taken at order time; never re-resolved from the catalog. */
  @Column()
  product_name: string;

  @Column()
  quantity: number;

  @Column('decimal', { precision: 10, scale: 2 })
  price: number;
}
