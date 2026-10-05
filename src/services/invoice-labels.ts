import { Locale } from '../i18n/locale';

export interface InvoiceLabels {
  title: string;
  seller: string;
  taxId: string;
  orderNumber: string;
  orderDate: string;
  billingAndShipping: string;
  billing: string;
  shipping: string;
  company: string;
  fullName: string;
  address: string;
  email: string;
  phone: string;
  products: string;
  productName: string;
  quantity: string;
  unitPrice: string;
  value: string;
  total: string;
  thanks: string;
}

export const INVOICE_LABELS: Record<Locale, InvoiceLabels> = {
  pl: {
    title: 'Faktura',
    seller: 'Sprzedawca',
    taxId: 'NIP',
    orderNumber: 'Numer zamówienia',
    orderDate: 'Data zamówienia',
    billingAndShipping: 'Dane do faktury i dostawy',
    billing: 'Dane do faktury',
    shipping: 'Dane do dostawy',
    company: 'Firma',
    fullName: 'Imię i nazwisko',
    address: 'Adres',
    email: 'Email',
    phone: 'Telefon',
    products: 'Produkty',
    productName: 'Nazwa produktu',
    quantity: 'Ilość',
    unitPrice: 'Cena (szt.)',
    value: 'Wartość',
    total: 'Razem',
    thanks: 'Dziękujemy za zakupy!',
  },
  en: {
    title: 'Invoice',
    seller: 'Seller',
    taxId: 'Tax ID (NIP)',
    orderNumber: 'Order number',
    orderDate: 'Order date',
    billingAndShipping: 'Billing and shipping details',
    billing: 'Billing details',
    shipping: 'Shipping details',
    company: 'Company',
    fullName: 'Full name',
    address: 'Address',
    email: 'Email',
    phone: 'Phone',
    products: 'Products',
    productName: 'Product name',
    quantity: 'Qty',
    unitPrice: 'Unit price',
    value: 'Amount',
    total: 'Total',
    thanks: 'Thank you for your purchase!',
  },
};
