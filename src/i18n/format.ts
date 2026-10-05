import { Locale, LOCALE_TAGS } from './locale';

/** Prices are always PLN; only the presentation follows the locale. */
export const CURRENCY = 'PLN';

/** Warsaw time on purpose: it is a Polish shop, and it keeps output identical whatever the server's TZ is. */
const TIME_ZONE = 'Europe/Warsaw';

export const formatCurrency = (value: number | string, locale: Locale) =>
  new Intl.NumberFormat(LOCALE_TAGS[locale], {
    style: 'currency',
    currency: CURRENCY,
  }).format(Number(value));

export const formatDate = (value: Date, locale: Locale) =>
  new Intl.DateTimeFormat(LOCALE_TAGS[locale], {
    dateStyle: 'medium',
    timeZone: TIME_ZONE,
  }).format(value);

export const formatDateTime = (value: Date, locale: Locale) =>
  new Intl.DateTimeFormat(LOCALE_TAGS[locale], {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: TIME_ZONE,
  }).format(value);
