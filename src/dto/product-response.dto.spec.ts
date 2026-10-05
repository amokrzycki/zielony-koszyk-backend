import { Product } from '../entities/product.entity';
import { ProductTranslation } from '../entities/product-translation.entity';
import { toProductResponse } from './product-response.dto';

const text = (locale: 'pl' | 'en', name: string) =>
  ({ locale, name, description: `${name} desc` }) as ProductTranslation;

const product = (extra: Partial<Product>) =>
  ({
    product_id: 4,
    price: 6.5,
    category: 'owoce',
    stock_quantity: 3,
    image: 'uploads/x.png',
    created_at: new Date(0),
    updated_at: new Date(0),
    ...extra,
  }) as Product;

describe('toProductResponse', () => {
  it('flattens the requested translation and exposes no translation structure', () => {
    const dto = toProductResponse(
      product({
        localized: text('en', 'Banana'),
        fallback: text('pl', 'Banan'),
      }),
    );

    expect(dto).toMatchObject({ name: 'Banana', description: 'Banana desc' });
    expect(dto).not.toHaveProperty('translations');
    expect(dto).not.toHaveProperty('localized');
    expect(dto).not.toHaveProperty('fallback');
  });

  it('falls back to the default-locale text when the requested one is missing', () => {
    const dto = toProductResponse(
      product({ localized: null, fallback: text('pl', 'Banan') }),
    );
    expect(dto.name).toBe('Banan');
  });

  it('returns empty text instead of throwing when no translation exists at all', () => {
    expect(toProductResponse(product({}))).toMatchObject({
      name: '',
      description: '',
    });
  });
});
