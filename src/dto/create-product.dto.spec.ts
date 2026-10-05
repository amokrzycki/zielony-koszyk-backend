import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProductDto, UpdateProductDto } from './create-product.dto';

const text = { name: 'Carrot', description: 'Sweet carrot' };
const shared = { price: 12.5, category: 'warzywa', stock_quantity: 0 };

describe('CreateProductDto translations', () => {
  it.each([
    { translations: undefined },
    { translations: null },
    { translations: [] },
  ])(
    'rejects a missing or non-object translations value: %j',
    async ({ translations }) => {
      const errors = await validate(
        plainToInstance(CreateProductDto, { ...shared, translations }),
      );
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ property: 'translations' }),
        ]),
      );
    },
  );

  it.each(['pl', 'en'] as const)('requires the %s object', async (locale) => {
    const translations: Record<string, unknown> = { pl: text, en: text };
    delete translations[locale];
    const errors = await validate(
      plainToInstance(CreateProductDto, { ...shared, translations }),
    );
    expect(errors[0]?.children).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: locale })]),
    );
  });

  it.each(['pl', 'en'] as const)('rejects an array for %s', async (locale) => {
    const errors = await validate(
      plainToInstance(CreateProductDto, {
        ...shared,
        translations: { pl: text, en: text, [locale]: [] },
      }),
    );
    expect(errors[0]?.children).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: locale })]),
    );
  });

  it('accepts complete translations and zero stock', async () => {
    expect(
      await validate(
        plainToInstance(CreateProductDto, {
          ...shared,
          translations: { pl: text, en: text },
        }),
      ),
    ).toEqual([]);
  });

  it('keeps single-language updates valid', async () => {
    expect(
      await validate(
        plainToInstance(UpdateProductDto, { translations: { en: text } }),
      ),
    ).toEqual([]);
  });
});
