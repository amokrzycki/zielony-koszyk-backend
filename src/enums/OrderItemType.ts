/** Machine-facing kind of an order line; domain logic must branch on this, never on the (localized) `product_name`. */
export enum OrderItemType {
  PRODUCT = 'PRODUCT',
  DELIVERY = 'DELIVERY',
}
