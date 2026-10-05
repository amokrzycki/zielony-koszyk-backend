import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ProductTranslation } from './product-translation.entity';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn()
  product_id: number;

  /** Localized name/description live in `product_translations`, one row per locale. */
  @OneToMany(() => ProductTranslation, (translation) => translation.product, {
    cascade: true,
  })
  translations: ProductTranslation[];

  /** Query-time joins of the requested locale's row and the default-locale fallback; never persisted. */
  localized?: ProductTranslation | null;
  fallback?: ProductTranslation | null;

  @Column('decimal', { precision: 10, scale: 2 })
  price: number;

  /** Opaque, language-independent category id (e.g. 'owoce'); display labels belong to the clients. */
  @Column()
  category: string;

  @Column()
  stock_quantity: number;

  @Column({ nullable: true, default: 'uploads/placeholder.jpg' })
  image: string;

  @CreateDateColumn()
  created_at: Date;

  @CreateDateColumn()
  updated_at: Date;
}
