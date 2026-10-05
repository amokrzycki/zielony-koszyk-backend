import { Injectable } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import * as path from 'path';
import * as fs from 'fs';
import { Order } from '../entities/order.entity';
import { CustomerType } from '../types/CustomerType';
import { OrderType } from '../types/OrderType';
import { formatCurrency, formatDate } from '../i18n/format';
import { INVOICE_FILE_PREFIX } from '../i18n/labels';
import { INVOICE_LABELS } from './invoice-labels';

/** User-facing file name, in the order's language. */
export const invoiceFileName = (order: Pick<Order, 'order_id' | 'locale'>) =>
  `${INVOICE_FILE_PREFIX[order.locale]}_${order.order_id}.pdf`;

@Injectable()
export class InvoiceService {
  async generateInvoicePDF(
    order: Order,
    same_address: boolean,
  ): Promise<Buffer> {
    const { locale } = order;
    const l = INVOICE_LABELS[locale];
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
    });
    const chunks: Buffer[] = [];

    doc.registerFont(
      'OpenSansRegular',
      path.join(process.cwd(), 'fonts', 'OpenSans-Regular.ttf'),
    );
    doc.registerFont(
      'OpenSansBold',
      path.join(process.cwd(), 'fonts', 'OpenSans-Bold.ttf'),
    );

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    const logoPath = path.join(process.cwd(), 'assets', 'logo.png');

    const widthLogo = 100;
    const pageWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;

    const centerX = doc.page.margins.left + (pageWidth - widthLogo) / 2;

    doc.image(logoPath, centerX, doc.y, { width: widthLogo });

    doc.moveDown(5);

    doc.font('OpenSansBold').fontSize(20).text(l.title, {
      align: 'center',
    });

    doc.moveDown();

    this.drawLine(doc);

    doc
      .moveDown(0.5)
      .font('OpenSansRegular')
      .fontSize(12)
      .text(`${l.seller}: ZIELONY KOSZYK`)
      .text(`ul. Mokrzyckiego 4/20`)
      .text(`36-105 Cmolas`)
      .text(`${l.taxId}: 6902137420`);

    doc.moveDown();

    this.drawLine(doc);

    doc
      .moveDown(0.5)
      .font('OpenSansRegular')
      .fontSize(12)
      .text(`${l.orderNumber}: ${order.order_id}`)
      .text(`${l.orderDate}: ${formatDate(order.order_date, locale)}`)
      .text(`${same_address ? l.billingAndShipping : l.billing}:`);

    if (order.order_type === OrderType.COMPANY) {
      doc.text(`${l.company}: ${order.billingAddress.company_name}`);
      doc.text(`${l.taxId}: ${order.billingAddress.nip}`);
    } else {
      doc.text(
        `${l.fullName}: ${order.billingAddress.first_name} ${order.billingAddress.last_name}`,
      );
    }

    doc
      .text(
        `${l.address}: ${order.billingAddress.street} ${order.billingAddress.building_number}${order.billingAddress.flat_number ? `/${order.billingAddress.flat_number}` : ''}, ${order.billingAddress.zip} ${order.billingAddress.city}`,
      )
      .text(`${l.email}: ${order.customer_email}`)
      .text(`${l.phone}: ${order.billingAddress.phone}`);

    doc.moveDown();

    this.drawLine(doc);

    if (!same_address) {
      doc
        .moveDown(0.5)
        .font('OpenSansRegular')
        .fontSize(12)
        .text(`${l.shipping}:`);

      if (order.shippingAddress.customer_type === CustomerType.COMPANY) {
        doc.text(`${l.company}: ${order.shippingAddress.company_name}`);
        doc.text(`${l.taxId}: ${order.shippingAddress.nip}`);
      } else {
        doc.text(
          `${l.fullName}: ${order.shippingAddress.first_name} ${order.shippingAddress.last_name}`,
        );
      }
      doc
        .text(`${l.phone}: ${order.shippingAddress.phone}`)
        .text(
          `${l.address}: ${order.shippingAddress.street} ${order.shippingAddress.building_number} ${order.shippingAddress.flat_number ? `/${order.shippingAddress.flat_number}` : ''}, ${order.shippingAddress.zip} ${order.shippingAddress.city}`,
        );

      doc.moveDown();

      this.drawLine(doc);
    }

    doc
      .moveDown(1)
      .font('OpenSansBold')
      .fontSize(14)
      .text(`${l.products}:`, { align: 'center' });
    doc.moveDown(0.5);

    const tableTopY = doc.y;
    doc
      .fontSize(12)
      .text(l.productName, 50, tableTopY, { width: 200, align: 'left' })
      .text(l.quantity, 250, tableTopY, { width: 80, align: 'right' })
      .text(l.unitPrice, 330, tableTopY, { width: 100, align: 'right' })
      .text(l.value, 430, tableTopY, { width: 100, align: 'right' });

    let currentY = tableTopY + doc.currentLineHeight() + 5;

    doc.font('OpenSansRegular');

    let totalAmount = 0;

    order.orderItems.forEach((item) => {
      const itemValue = Number(item.price) * item.quantity;
      totalAmount += itemValue;

      doc
        .text(item.product_name, 50, currentY, { width: 200, align: 'left' })
        .text(String(item.quantity), 250, currentY, {
          width: 80,
          align: 'right',
        })
        .text(formatCurrency(item.price, locale), 330, currentY, {
          width: 100,
          align: 'right',
        })
        .text(formatCurrency(itemValue, locale), 430, currentY, {
          width: 100,
          align: 'right',
        });

      currentY += doc.currentLineHeight() + 5;
    });

    doc
      .moveTo(50, currentY + 5)
      .lineTo(doc.page.width - doc.page.margins.right, currentY + 5)
      .stroke();

    currentY += 15;

    doc
      .font('OpenSansBold')
      .text(`${l.total}:`, 50, currentY, { width: 380, align: 'right' })
      .text(formatCurrency(totalAmount, locale), 430, currentY, {
        width: 100,
        align: 'right',
      });

    doc.moveDown(2);

    doc.font('OpenSansRegular').fontSize(10).text(l.thanks, {
      align: 'center',
    });

    doc.end();

    return new Promise<Buffer>((resolve) => {
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        resolve(pdfBuffer);
      });
    });
  }

  saveInvoiceToDisk(order: Order, pdfBuffer: Buffer): string {
    const invoiceDir = path.join(process.cwd(), 'invoices');

    if (!fs.existsSync(invoiceDir)) {
      fs.mkdirSync(invoiceDir, { recursive: true });
    }

    const filename = `invoice_order_${order.order_id}.pdf`;
    const filePath = path.join(invoiceDir, filename);
    fs.writeFileSync(filePath, pdfBuffer);
    return filename;
  }

  private drawLine(doc: PDFKit.PDFDocument) {
    const y = doc.y;
    doc
      .moveTo(doc.page.margins.left, y)
      .lineTo(doc.page.width - doc.page.margins.right, y)
      .stroke();
  }
}
