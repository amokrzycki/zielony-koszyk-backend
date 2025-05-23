import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Mailgun from 'mailgun.js';
import { Order } from '../entities/order.entity';
import { IMailgunClient } from 'mailgun.js/Interfaces';
import Handlebars from 'handlebars';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { formatDate } from '../utils/formatDate';
import FormData from 'form-data';
import { User } from '../entities/user.entity';
import { OrderType } from '../types/OrderType';

// TODO: Password change email confirmation
// TODO: Email change email confirmation
// TODO: Password reset email

@Injectable()
export class MailService {
  private mg: IMailgunClient;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('MAILGUN_API_KEY');
    const host = this.configService.get<string>('MAILGUN_HOST');
    const mailgun = new Mailgun(FormData);
    this.mg = mailgun.client({
      username: 'api',
      key: apiKey,
      url: host,
    });
  }

  async sendOrderConfirmation(
    order: Order,
    pdfBuffer: Buffer<ArrayBufferLike>,
  ): Promise<void> {
    const domain = this.configService.get<string>('MAILGUN_DOMAIN');
    const fromEmail = this.configService.get<string>('MAILGUN_FROM_EMAIL');

    // Read and compile the template
    const templateSource = fs.readFileSync(
      path.join(__dirname, '../constants/order-confirmation.hbs'),
      'utf8',
    );
    const template = Handlebars.compile(templateSource);

    const customer_name =
      order.order_type === OrderType.COMPANY
        ? order.billingAddress.company_name
        : order.billingAddress.first_name +
          ' ' +
          order.billingAddress.last_name;

    const preparedItems = order.orderItems.map((item) => ({
      product_name: item.product_name,
      quantity: item.quantity,
      price: item.price,
      isDelivery: item.product_name === 'Dostawa',
    }));

    // Generate the email content
    const html = template({
      customer_name,
      order_id: order.order_id,
      order_date: formatDate(order.order_date),
      total_amount: order.total_amount,
      orderItems: preparedItems,
    });

    const attachment = {
      data: pdfBuffer,
      filename: `Faktura_${order.order_id}.pdf`,
      contentType: 'application/pdf',
    };

    const data = {
      from: `Zielony Koszyk <${fromEmail}>`,
      to: order.customer_email,
      subject: 'Potwierdzenie zamówienia',
      html, // Use the generated HTML
      attachment: [attachment],
    };

    try {
      await this.mg.messages.create(domain, data);
    } catch (error) {
      console.error(error);
    }
  }

  async sendEmailWithPassword(user: User, password: string): Promise<void> {
    const domain = this.configService.get<string>('MAILGUN_DOMAIN');
    const fromEmail = this.configService.get<string>('MAILGUN_FROM_EMAIL');

    const templateSource = fs.readFileSync(
      path.join(__dirname, '../constants/welcome-email-created-user.hbs'),
      'utf8',
    );

    const template = Handlebars.compile(templateSource);

    const html = template({
      customer_name: `${user.first_name} ${user.last_name}`,
      email: user.email,
      password: password,
      login_url: 'http://localhost:3000/login',
      contact_email: 'amokrzycki96@gmail.com',
    });

    const data = {
      from: `Zielony Koszyk <${fromEmail}>`,
      to: user.email,
      subject: 'Witaj w Zielonym Koszyku!',
      html,
    };

    // Send the email using the Mailgun API and console.log the response or catch the error
    try {
      await this.mg.messages.create(domain, data);
    } catch (error) {
      console.error(error);
    }
  }
}
