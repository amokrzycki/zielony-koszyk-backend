import { Product } from '../entities/product.entity';

/** What the catalog API returns: one language, already resolved. Translation storage is not exposed. */
export interface ProductResponseDto {
  product_id: number;
  name: string;
  description: string;
  price: number;
  category: string;
  stock_quantity: number;
  image: string;
  created_at: Date;
  updated_at: Date;
}

/** Expects `localized`/`fallback` to be joined (see ProductService); a product with neither gets empty text. */
export const toProductResponse = (product: Product): ProductResponseDto => {
  const text = product.localized ?? product.fallback;
  return {
    product_id: product.product_id,
    name: text?.name ?? '',
    description: text?.description ?? '',
    price: product.price,
    category: product.category,
    stock_quantity: product.stock_quantity,
    image: product.image,
    created_at: product.created_at,
    updated_at: product.updated_at,
  };
};
