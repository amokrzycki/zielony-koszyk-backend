import {
  Column,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
} from 'typeorm';
import { Orders } from './orders.entity';
import { Products } from './products.entity';
import { Exclude } from 'class-transformer';

@Entity()
export class OrderItems {
  @PrimaryGeneratedColumn()
  order_item_id: number;

  @ManyToOne(() => Orders, (order) => order.orderItems)
  @Exclude({ toPlainOnly: true })
  order_id: number;

  @ManyToOne(() => Products)
  product: Relation<Products>;

  @Column()
  product_name: string;

  @Column()
  quantity: number;

  @Column('decimal', { precision: 10, scale: 2 })
  price: number;
}
