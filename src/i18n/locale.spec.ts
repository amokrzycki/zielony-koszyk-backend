import { DEFAULT_LOCALE, resolveLocale, toLocale } from './locale';

describe('resolveLocale', () => {
  it.each([
    ['en', 'en'],
    ['pl', 'pl'],
    ['en-US', 'en'],
    ['EN-gb', 'en'],
    ['pl-PL,pl;q=0.9,en;q=0.8', 'pl'],
    ['en-US,en;q=0.9,pl;q=0.8', 'en'],
    ['de-DE,en;q=0.7', 'en'],
    ['en;q=0.5,pl;q=0.9', 'pl'],
    ['pl;q=0,en;q=0.4', 'en'],
  ])('%s -> %s', (header, expected) => {
    expect(resolveLocale(header)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    '',
    '*',
    'de',
    'fr-CA,de;q=0.8',
    'en;q=0',
    ';;;,,,',
  ])('falls back to the default locale for %p', (header) => {
    expect(resolveLocale(header)).toBe(DEFAULT_LOCALE);
  });

  it('accepts a repeated header delivered as an array', () => {
    expect(resolveLocale(['de', 'en-US'])).toBe('en');
  });

  it('treats a malformed q-value as absent instead of throwing', () => {
    expect(resolveLocale('en;q=abc')).toBe('en');
  });

  it('keeps toLocale language-only', () => {
    expect(toLocale('en_US')).toBe('en');
    expect(toLocale('xx')).toBeNull();
  });
});
