import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as FormData from 'form-data';
import Mailgun from 'mailgun.js';
import { Order } from '../entities/order.entity';
import { IMailgunClient } from 'mailgun.js/Interfaces';
import Handlebars from 'handlebars';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { formatDate } from '../utils/formatDate';

@Injectable()
export class MailService {
  private mg: IMailgunClient;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('MAILGUN_API_KEY');
    const mailgun = new Mailgun(FormData);
    this.mg = mailgun.client({
      username: 'api',
      key: apiKey,
    });
  }

  async sendOrderConfirmation(order: Order): Promise<void> {
    const domain = this.configService.get<string>('MAILGUN_DOMAIN');
    const fromEmail = this.configService.get<string>('MAILGUN_FROM_EMAIL');

    // Read and compile the template
    const templateSource = fs.readFileSync(
      path.join(__dirname, '../constants/order-confirmation.hbs'),
      'utf8',
    );
    const template = Handlebars.compile(templateSource);

    // Generate the email content
    const html = template({
      customer_name: order.customer_name,
      order_id: order.order_id,
      order_date: formatDate(order.order_date),
      total_amount: order.total_amount,
      orderDetails: order.orderDetails,
    });

    const data = {
      from: `Zielony Koszyk <${fromEmail}>`,
      to: order.customer_email,
      subject: 'Potwierdzenie zamówienia',
      html, // Use the generated HTML
    };

    await this.mg.messages.create(domain, data);
  }
}
