import {
  EventSubscriber,
  EntitySubscriberInterface,
  UpdateEvent,
  RemoveEvent,
  InsertEvent,
  DataSource,
  EntityManager,
} from 'typeorm';
import { OrderItem } from '../entities/order-item.entity';
import { Order } from '../entities/order.entity';

@EventSubscriber()
export class OrderItemSubscriber
  implements EntitySubscriberInterface<OrderItem>
{
  constructor(private dataSource: DataSource) {
    this.dataSource.subscribers.push(this);
  }

  listenTo() {
    return OrderItem;
  }

  async afterInsert(event: InsertEvent<OrderItem>) {
    const itemRepo = event.manager.getRepository(OrderItem);

    const newItem = await itemRepo.findOne({
      where: { order_item_id: event.entity?.order_item_id },
      relations: ['order'],
    });

    if (!newItem) {
      return;
    }

    if (!newItem.order) {
      return;
    }

    await this.recalcOrderTotal(newItem.order.order_id, event.manager);
  }

  async afterUpdate(event: UpdateEvent<OrderItem>) {
    if (!event.entity) {
      return;
    }

    const itemRepo = event.manager.getRepository(OrderItem);

    const orderItem = event.entity as OrderItem;
    const updatedItem = await itemRepo.findOne({
      where: { order_item_id: orderItem.order_item_id },
      relations: ['order'],
    });

    if (!updatedItem) {
      return;
    }

    if (!updatedItem.order) {
      return;
    }

    await this.recalcOrderTotal(updatedItem.order.order_id, event.manager);
  }

  async afterRemove(event: RemoveEvent<OrderItem>) {
    const itemRepo = event.manager.getRepository(OrderItem);

    const removedItem = await itemRepo.findOne({
      where: { order_item_id: event.entity?.order_item_id },
      relations: ['order'],
    });

    if (!removedItem) {
      return;
    }

    if (!removedItem.order) {
      return;
    }

    await this.recalcOrderTotal(removedItem.order.order_id, event.manager);
  }

  private async recalcOrderTotal(orderId: number, manager: EntityManager) {
    const orderRepo = manager.getRepository(Order);

    const order = await orderRepo.findOne({
      where: { order_id: orderId },
      relations: ['orderItems'],
    });
    if (!order) return;

    let newTotal = 0;
    for (const item of order.orderItems) {
      newTotal += Number(item.price) * item.quantity;
    }

    order.total_amount = newTotal;
    await orderRepo.save(order);
  }
}
