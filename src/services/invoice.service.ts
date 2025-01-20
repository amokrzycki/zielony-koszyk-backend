import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import * as path from 'path';
import * as fs from 'fs';
import { Order } from '../entities/order.entity';

@Injectable()
export class InvoiceService {
  async generateInvoicePDF(order: Order): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4' });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    doc.fontSize(20).text('Faktura', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).text(`Numer zamówienia: ${order.order_id}`);
    doc.text(`Data zamówienia: ${order.order_date.toLocaleDateString()}`);

    if (order.order_type === 'COMPANY') {
      doc.text(`Firma: ${order.customer_name}`);
      doc.text(`NIP: ${order.nip}`);
    } else {
      doc.text(`Paragon`);
    }

    doc.moveDown();
    doc.fontSize(16).text('Produkty:', { align: 'center' });

    doc.end();

    return new Promise<Buffer>((resolve) => {
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        resolve(pdfBuffer);
      });
    });
  }

  async saveInvoiceToDisk(order: Order, pdfBuffer: Buffer): Promise<string> {
    const invoiceDir = path.join(__dirname, '../../invoices');

    if (!fs.existsSync(invoiceDir)) {
      fs.mkdirSync(invoiceDir, { recursive: true });
    }

    const filename = `invoice_order_${order.order_id}.pdf`;
    const filePath = path.join(invoiceDir, filename);
    fs.writeFileSync(filePath, pdfBuffer);
    return filename;
  }
}
