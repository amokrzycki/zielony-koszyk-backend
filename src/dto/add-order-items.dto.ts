/** `product_name` is deliberately absent: the snapshot is resolved server-side in the order's language. */
export class AddOrderItemsDto {
  order_id: number;
  product_id: number;
  quantity: number;
  price: number;
}
