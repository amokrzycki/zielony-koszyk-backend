import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
  OneToMany,
} from 'typeorm';
import { Users } from './users.entity';
import { Statuses } from '../enums/Statuses';
import { OrderItems } from './order-items.entity';
import { Exclude } from 'class-transformer';

@Entity()
export class Orders {
  @PrimaryGeneratedColumn()
  order_id: number;

  @Column('char', { length: 36, nullable: true })
  user_id: string;

  @ManyToOne(() => Users)
  @Exclude()
  @JoinColumn({ name: 'user_id' })
  user: Users;

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

  @OneToMany(() => OrderItems, (orderItem) => orderItem.order, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  orderItems: OrderItems[];
}
