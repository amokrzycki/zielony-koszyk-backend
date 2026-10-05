import type { Locale } from '../i18n/locale';

export interface ProductText {
  name: string;
  description: string;
}

/** One catalog fixture: shared fields once, localized text per locale. */
export interface ProductSeed {
  price: number;
  category: string;
  stock_quantity: number;
  image: string;
  translations: Record<Locale, ProductText>;
}
