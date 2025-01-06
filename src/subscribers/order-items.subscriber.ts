import {
  EventSubscriber,
  EntitySubscriberInterface,
  UpdateEvent,
  RemoveEvent,
  DataSource,
  EntityManager,
} from 'typeorm';
import { OrderItems } from '../entities/order-items.entity';
import { Orders } from '../entities/orders.entity';

@EventSubscriber()
export class OrderItemsSubscriber
  implements EntitySubscriberInterface<OrderItems>
{
  constructor(private dataSource: DataSource) {
    this.dataSource.subscribers.push(this);
  }

  listenTo() {
    return OrderItems;
  }

  async afterUpdate(event: UpdateEvent<OrderItems>) {
    console.log('[Subscriber] afterUpdate triggered!');

    const itemRepo = event.manager.getRepository(OrderItems);

    const updatedItem = await itemRepo.findOne({
      where: { order_item_id: event.entity?.order_item_id },
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

  async afterRemove(event: RemoveEvent<OrderItems>) {
    console.log('[Subscriber] afterRemove triggered!');

    const itemRepo = event.manager.getRepository(OrderItems);

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
    const orderRepo = manager.getRepository(Orders);

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
