import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  OneToMany,
} from 'typeorm';
import { User } from './user.entity';
import { OrderDetail } from './order-detail.entity';
import { Statuses } from '../enums/Statuses';

@Entity()
export class Order {
  @PrimaryGeneratedColumn()
  order_id: number;

  @ManyToOne(() => User, { nullable: true })
  user: User;

  // Guest user information
  @Column({ nullable: true })
  customer_name: string;

  @Column({ nullable: true })
  customer_email: string;

  @Column({ nullable: true })
  customer_phone: string;

  @Column({ nullable: true })
  customer_address: string;

  @CreateDateColumn()
  order_date: Date;

  @Column('decimal', { precision: 10, scale: 2 })
  total_amount: number;

  @Column({ type: 'enum', enum: Statuses })
  status: Statuses;

  @OneToMany(() => OrderDetail, (orderDetail) => orderDetail.order, {
    cascade: true,
  })
  orderDetails: OrderDetail[];
}
