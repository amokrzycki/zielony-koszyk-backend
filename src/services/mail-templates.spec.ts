import * as fs from 'node:fs';
import * as path from 'node:path';
import { LOCALES } from '../i18n/locale';
import {
  MailTemplate,
  renderMailTemplate,
  templateFileName,
} from './mail-templates';

const TEMPLATES: MailTemplate[] = [
  'mfa-otp',
  'order-confirmation',
  'welcome-email-created-user',
];

describe('mail templates', () => {
  it.each(TEMPLATES.flatMap((t) => LOCALES.map((l) => [t, l] as const)))(
    '%s exists for locale %s',
    (template, locale) => {
      const file = path.join(
        __dirname,
        '../constants',
        templateFileName(template, locale),
      );
      expect(fs.existsSync(file)).toBe(true);
    },
  );

  it('renders the OTP template in the requested language only', () => {
    const pl = renderMailTemplate('mfa-otp', 'pl', { code: '123456' });
    const en = renderMailTemplate('mfa-otp', 'en', { code: '123456' });

    expect(pl).toContain('Twój kod logowania');
    expect(pl).toContain('123456');
    expect(en).toContain('Your login code');
    expect(en).toContain('123456');
    expect(en).not.toContain('Twój');
  });

  it('hides the quantity on the delivery line, per the machine flag, in both languages', () => {
    const context = {
      customer_name: 'Jan Kowalski',
      order_id: 7,
      order_date: 'today',
      total_amount: '100',
      orderItems: [
        { product_name: 'Item', quantity: 3, price: '1', isDelivery: false },
        { product_name: 'Ship', quantity: 1, price: '2', isDelivery: true },
      ],
    };
    for (const locale of LOCALES) {
      const html = renderMailTemplate('order-confirmation', locale, context);
      expect(html).toContain('x3');
      expect(html).not.toContain('x1');
      expect(html).toContain(
        `<html lang="${locale === 'pl' ? 'pl-PL' : 'en'}">`,
      );
    }
  });
});
