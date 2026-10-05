import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../entities/product.entity';
import { ProductTranslation } from '../entities/product-translation.entity';
import { DEFAULT_LOCALE, LOCALES } from '../i18n/locale';
import { ProductSeed } from './product-seed';
import vegatables from '../constants/vegatables';
import fruits from '../constants/fruits';
import others from '../constants/others';
import seasonal from '../constants/seasonal';
import collective from '../constants/collective';

@Injectable()
export class ProductsSeedService {
  constructor(
    @InjectRepository(Product)
    private productsRepository: Repository<Product>,
    @InjectRepository(ProductTranslation)
    private translationsRepository: Repository<ProductTranslation>,
  ) {}

  /**
   * Idempotent: a fixture is matched to an existing product by its Polish name, and any translation the product is
   * missing is added (existing text is never overwritten). Running it on a catalog that predates the English
   * translations therefore fills them in instead of duplicating products.
   */
  async seed() {
    const products: ProductSeed[] = [
      ...fruits,
      ...vegatables,
      ...others,
      ...seasonal,
      ...collective,
    ];

    for (const { translations, ...shared } of products) {
      const existing = await this.translationsRepository.findOne({
        where: {
          locale: DEFAULT_LOCALE,
          name: translations[DEFAULT_LOCALE].name,
        },
      });

      if (!existing) {
        await this.productsRepository.save(
          this.productsRepository.create({
            ...shared,
            translations: LOCALES.map((locale) => ({
              locale,
              ...translations[locale],
            })),
          }),
        );
        continue;
      }

      for (const locale of LOCALES) {
        const present = await this.translationsRepository.existsBy({
          product_id: existing.product_id,
          locale,
        });
        if (!present) {
          await this.translationsRepository.insert({
            product_id: existing.product_id,
            locale,
            ...translations[locale],
          });
        }
      }
    }
  }
}
