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

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn()
  order_id: number;

  @Column('char', { length: 36, nullable: true })
  user_id: string;

  @Column({ type: 'enum', enum: OrderType, default: OrderType.PRIVATE })
  order_type: OrderType;

  @Column({ nullable: true })
  nip: string;

  @ManyToOne(() => User)
  @Exclude()
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column()
  customer_name: string;

  @Column()
  customer_email: string;

  @Column()
  customer_phone: string;

  @Column()
  customer_address: string;

  @CreateDateColumn()
  order_date: Date;

  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  total_amount: number;

  @Column({ type: 'enum', enum: Statuses })
  status: Statuses;

  @OneToMany(() => OrderItem, (orderItem) => orderItem.order, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  orderItems: OrderItem[];

  @Column({ nullable: true })
  invoice_path: string;
}
