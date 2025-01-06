import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
} from 'typeorm';
import { Orders } from './orders.entity';
import { Products } from './products.entity';
import { Exclude } from 'class-transformer';

@Entity('order_items')
export class OrderItems {
  @PrimaryGeneratedColumn()
  order_item_id: number;

  @Column()
  order_id: number;

  @ManyToOne(() => Orders, (order) => order.orderItems, {
    onDelete: 'CASCADE',
  })
  @Exclude()
  @JoinColumn({ name: 'order_id' })
  order: Orders;

  @Column({ nullable: true })
  product_id: number;

  @ManyToOne(() => Products)
  @JoinColumn({ name: 'product_id' })
  product: Relation<Products>;

  @Column()
  product_name: string;

  @Column()
  quantity: number;

  @Column('decimal', { precision: 10, scale: 2 })
  price: number;
}
