import { DEFAULT_LOCALE, Locale } from './locale';

/** Requested locale first, then the default locale; `undefined` if the product has neither. */
export const pickTranslation = <T extends { locale: Locale }>(
  translations: readonly T[],
  locale: Locale,
): T | undefined =>
  translations.find((translation) => translation.locale === locale) ??
  translations.find((translation) => translation.locale === DEFAULT_LOCALE);
