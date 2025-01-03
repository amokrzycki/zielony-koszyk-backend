import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  OneToMany,
} from 'typeorm';
import { Users } from './users.entity';
import { Statuses } from '../enums/Statuses';
import { OrderItems } from './order-items.entity';

@Entity()
export class Orders {
  @PrimaryGeneratedColumn()
  order_id: number;

  @ManyToOne(() => Users, { nullable: true })
  user_id: string;

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

  @Column('decimal', { precision: 10, scale: 2 })
  total_amount: number;

  @Column({ type: 'enum', enum: Statuses })
  status: Statuses;

  @OneToMany(() => OrderItems, (orderItem) => orderItem.order_id, {
    cascade: true,
  })
  orderItems: OrderItems[];
}
