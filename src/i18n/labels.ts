import { Locale } from './locale';

/** Name stored on the shipping order line, in the order's language (the line is identified by `item_type`, not this). */
export const DELIVERY_LABEL: Record<Locale, string> = {
  pl: 'Dostawa',
  en: 'Delivery',
};

export const MAIL_SUBJECTS: Record<
  Locale,
  { mfaOtp: string; orderConfirmation: string; welcome: string }
> = {
  pl: {
    mfaOtp: 'Kod logowania do Zielonego Koszyka',
    orderConfirmation: 'Potwierdzenie zamówienia',
    welcome: 'Witaj w Zielonym Koszyku!',
  },
  en: {
    mfaOtp: 'Your Zielony Koszyk login code',
    orderConfirmation: 'Order confirmation',
    welcome: 'Welcome to Zielony Koszyk!',
  },
};

/** Login page slug per locale; mirrors the frontend route table, which owns the URLs. */
export const LOGIN_PATH: Record<Locale, string> = {
  pl: 'logowanie',
  en: 'login',
};

export const INVOICE_FILE_PREFIX: Record<Locale, string> = {
  pl: 'Faktura',
  en: 'Invoice',
};
