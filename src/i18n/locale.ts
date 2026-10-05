export const LOCALES = ['pl', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

/** Fallback for missing/unsupported languages and for missing translations. */
export const DEFAULT_LOCALE: Locale = 'pl';

/** BCP 47 tags for `Intl`: the API locale is language-only, formatting wants a region. */
export const LOCALE_TAGS: Record<Locale, string> = {
  pl: 'pl-PL',
  en: 'en-GB',
};

export const isLocale = (value: unknown): value is Locale =>
  LOCALES.includes(value as Locale);

/** Language-only matching: `en-US`, `EN_gb` and `en` all resolve to `en`. */
export const toLocale = (code: string | null | undefined): Locale | null => {
  const language = code?.trim().toLowerCase().split(/[-_]/)[0];
  return isLocale(language) ? language : null;
};

/**
 * The one place that parses `Accept-Language` (RFC 9110 §12.5.4). Honors q-values, skips `*`, `q=0` and unsupported
 * languages, and falls back to {@link DEFAULT_LOCALE} for anything missing or malformed.
 */
export const resolveLocale = (
  header: string | string[] | null | undefined,
): Locale => {
  const raw = Array.isArray(header) ? header.join(',') : header;
  if (!raw) return DEFAULT_LOCALE;

  const candidates = raw
    .split(',')
    .map((part, index) => {
      const [range, ...params] = part.trim().split(';');
      const q = params
        .map((param) => /^\s*q\s*=\s*([\d.]+)\s*$/i.exec(param)?.[1])
        .find((value) => value !== undefined);
      const quality = q === undefined ? 1 : Number(q);
      return { range, quality: Number.isNaN(quality) ? 0 : quality, index };
    })
    .filter(({ quality }) => quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);

  for (const { range } of candidates) {
    const locale = toLocale(range);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
};
