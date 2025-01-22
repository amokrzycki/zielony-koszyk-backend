import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import * as path from 'path';
import * as fs from 'fs';
import { Order } from '../entities/order.entity';

@Injectable()
export class InvoiceService {
  async generateInvoicePDF(
    order: Order,
    same_address: boolean,
  ): Promise<Buffer> {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
    });
    const chunks: Buffer[] = [];

    doc.registerFont(
      'OpenSansRegular',
      path.join(__dirname, '../../fonts', 'OpenSans-Regular.ttf'),
    );
    doc.registerFont(
      'OpenSansBold',
      path.join(__dirname, '../../fonts', 'OpenSans-Bold.ttf'),
    );

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    const logoPath = path.join(__dirname, '../../assets', 'logo.png'); // Dostosuj ścieżkę

    const widthLogo = 100;
    const pageWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;

    const centerX = doc.page.margins.left + (pageWidth - widthLogo) / 2;

    doc.image(logoPath, centerX, doc.y, { width: widthLogo });

    doc.moveDown(5);

    doc.font('OpenSansBold').fontSize(20).text('Faktura', {
      align: 'center',
    });

    doc.moveDown();

    this.drawLine(doc);

    doc
      .moveDown(0.5)
      .font('OpenSansRegular')
      .fontSize(12)
      .text(`Sprzedawca: ZIELONY KOSZYK`)
      .text(`ul. Okrzei 26/1`)
      .text(`05-500 Piaseczno`)
      .text(`NIP: 5441112223`);

    doc.moveDown();

    this.drawLine(doc);

    doc
      .moveDown(0.5)
      .font('OpenSansRegular')
      .fontSize(12)
      .text(`Numer zamówienia: ${order.order_id}`)
      .text(`Data zamówienia: ${order.order_date.toLocaleDateString()}`)
      .text(
        `${same_address ? 'Dane do faktury i dostawy' : 'Dane do faktury'}:`,
      );

    if (order.order_type === 'COMPANY') {
      doc.text(`Firma: ${order.billingAddress.company_name}`);
      doc.text(`NIP: ${order.billingAddress.nip}`);
    } else {
      doc.text(
        `Imię i nazwisko: ${order.billingAddress.first_name} ${order.billingAddress.last_name}`,
      );
    }

    doc
      .text(
        `Adres: ${order.billingAddress.street} ${order.billingAddress.building_number}${order.billingAddress.flat_number ? `/${order.billingAddress.flat_number}` : ''} ${order.billingAddress.zip}, ${order.billingAddress.city}`,
      )
      .text(`Email: ${order.customer_email}`)
      .text(`Telefon: ${order.billingAddress.phone}`);

    doc.moveDown();

    this.drawLine(doc);

    if (!same_address) {
      doc
        .moveDown(0.5)
        .font('OpenSansRegular')
        .fontSize(12)
        .text('Dane do dostawy:');

      if (order.order_type === 'COMPANY') {
        doc.text(`Firma: ${order.shippingAddress.company_name}`);
        doc.text(`NIP: ${order.shippingAddress.nip}`);
      } else {
        doc.text(
          `Imię i nazwisko: ${order.shippingAddress.first_name} ${order.shippingAddress.last_name}`,
        );
      }
      doc
        .text(`Telefon: ${order.shippingAddress.phone}`)
        .text(
          `Adres: ${order.shippingAddress.street} ${order.shippingAddress.building_number} ${order.shippingAddress.flat_number ? `/${order.shippingAddress.flat_number}` : ''} ${order.shippingAddress.zip}, ${order.shippingAddress.city}`,
        );

      doc.moveDown();

      this.drawLine(doc);
    }

    doc
      .moveDown(1)
      .font('OpenSansBold')
      .fontSize(14)
      .text('Produkty:', { align: 'center' });
    doc.moveDown(0.5);

    const tableTopY = doc.y;
    doc
      .fontSize(12)
      .text('Nazwa produktu', 50, tableTopY, { width: 200, align: 'left' })
      .text('Ilość', 250, tableTopY, { width: 80, align: 'right' })
      .text('Cena (szt.)', 330, tableTopY, { width: 100, align: 'right' })
      .text('Wartość', 430, tableTopY, { width: 100, align: 'right' });

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
        .text(`${Number(item.price).toFixed(2)} zł`, 330, currentY, {
          width: 100,
          align: 'right',
        })
        .text(`${itemValue.toFixed(2)} zł`, 430, currentY, {
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
      .text('Razem:', 50, currentY, { width: 380, align: 'right' })
      .text(`${totalAmount.toFixed(2)} zł`, 430, currentY, {
        width: 100,
        align: 'right',
      });

    doc.moveDown(2);

    doc.font('OpenSansRegular').fontSize(10).text('Dziękujemy za zakupy!', {
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

  private drawLine(doc: PDFKit.PDFDocument) {
    const y = doc.y;
    doc
      .moveTo(doc.page.margins.left, y)
      .lineTo(doc.page.width - doc.page.margins.right, y)
      .stroke();
  }
}
