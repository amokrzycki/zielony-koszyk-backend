/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-base-to-string -- spies on pdfkit's prototype, which is untyped */
import PDFDocument = require('pdfkit');
import { InvoiceService, invoiceFileName } from './invoice.service';
import { INVOICE_LABELS } from './invoice-labels';
import { LOCALES } from '../i18n/locale';
import { order } from '../tests/support/order-fixtures';

/** Captures what is drawn instead of parsing the (compressed) PDF stream. */
const captureText = async (run: () => Promise<Buffer>) => {
  const drawn: string[] = [];
  const original = PDFDocument.prototype.text;
  jest.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (
    this: PDFKit.PDFDocument,
    ...args
  ) {
    // Intl separates currency and amount with a no-break space; compare with plain spaces.
    drawn.push(String(args[0]).replace(/\s/g, ' '));
    return original.apply(this, args);
  });
  const buffer = await run();
  return { drawn, buffer };
};

describe('InvoiceService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('has a label for every key in every locale', () => {
    const keys = Object.keys(INVOICE_LABELS.pl).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(INVOICE_LABELS[locale]).sort()).toEqual(keys);
      expect(Object.values(INVOICE_LABELS[locale]).every(Boolean)).toBe(true);
    }
  });

  it('renders the invoice in Polish for a Polish order', async () => {
    const { drawn, buffer } = await captureText(() =>
      new InvoiceService().generateInvoicePDF(order('pl'), true),
    );

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(drawn).toContain('Faktura');
    expect(drawn).toContain('Sprzedawca: ZIELONY KOSZYK');
    expect(drawn).toContain('Numer zamówienia: 7');
    expect(drawn.some((t) => t.startsWith('Data zamówienia: 5 mar 2026'))).toBe(
      true,
    );
    expect(drawn).toContain('Dane do faktury i dostawy:');
    expect(drawn).toContain('Banan');
    expect(drawn).toContain('Dostawa');
    expect(drawn).toContain('6,50 zł');
    expect(drawn).toContain('23,00 zł');
  });

  it('renders the invoice in English for an English order, using the stored name snapshots', async () => {
    const { drawn } = await captureText(() =>
      new InvoiceService().generateInvoicePDF(order('en'), false),
    );

    expect(drawn).toContain('Invoice');
    expect(drawn).toContain('Seller: ZIELONY KOSZYK');
    expect(drawn).toContain('Order number: 7');
    expect(drawn).toContain('Order date: 5 Mar 2026');
    expect(drawn).toContain('Billing details:');
    expect(drawn).toContain('Shipping details:');
    expect(drawn).toContain('Unit price');
    expect(drawn).toContain('Total:');
    expect(drawn).toContain('Thank you for your purchase!');
    expect(drawn).toContain('Banana');
    expect(drawn).toContain('Delivery');
    expect(drawn).toContain('PLN 6.50');
    expect(drawn).toContain('PLN 13.00');
    expect(drawn).toContain('PLN 23.00');
    expect(drawn).not.toContain('Faktura');
  });

  it('keeps long English labels inside their table columns', async () => {
    const { buffer } = await captureText(() =>
      new InvoiceService().generateInvoicePDF(order('en'), false),
    );
    // One page, i.e. nothing overflowed onto an extra page.
    expect(buffer.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1);
  });

  it('names the file after the order language', () => {
    expect(invoiceFileName(order('pl'))).toBe('Faktura_7.pdf');
    expect(invoiceFileName(order('en'))).toBe('Invoice_7.pdf');
  });
});
