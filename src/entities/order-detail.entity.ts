import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Order } from './order.entity';
import { Product } from './product.entity';
import { Exclude } from 'class-transformer';

@Entity()
export class OrderDetail {
  @PrimaryGeneratedColumn()
  order_detail_id: number;

  @ManyToOne(() => Order, (order) => order.orderDetails)
  @Exclude({ toPlainOnly: true })
  order_id: number;

  @ManyToOne(() => Product)
  product: Product;

  @Column()
  product_name: string;

  @Column()
  quantity: number;

  @Column('decimal', { precision: 10, scale: 2 })
  price: number;
}
