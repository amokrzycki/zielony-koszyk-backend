import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Product } from './product.entity';
import { LOCALES, Locale } from '../i18n/locale';

/** Postgres enum shared by every table that stores a locale. */
export const LOCALE_ENUM_NAME = 'locale_enum';

@Entity('product_translations')
export class ProductTranslation {
  @PrimaryColumn()
  product_id: number;

  @PrimaryColumn({
    type: 'enum',
    enum: [...LOCALES],
    enumName: LOCALE_ENUM_NAME,
  })
  locale: Locale;

  @ManyToOne(() => Product, (product) => product.translations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'product_id',
    foreignKeyConstraintName: 'FK_product_translations_product',
  })
  product: Product;

  @Column()
  name: string;

  @Column('text')
  description: string;
}
