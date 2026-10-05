import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import { order } from '../tests/support/order-fixtures';

const mockSendMail = jest
  .fn<Promise<unknown>, [{ subject: string; html: string }]>()
  .mockResolvedValue({ response: 'ok' });
const mockMailgunCreate = jest.fn().mockResolvedValue({});

jest.mock('mailgun.js', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    client: jest.fn(() => ({ messages: { create: mockMailgunCreate } })),
  })),
}));
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: mockSendMail,
    close: jest.fn(),
  })),
}));

const service = () =>
  new MailService({
    get: jest.fn((key: string) => (key === 'SMTP_FROM_EMAIL' ? 'a@b.pl' : '')),
  } as unknown as ConfigService);

describe('MailService localization', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends the OTP e-mail in Polish by default (unchanged for the research harness)', async () => {
    await service().sendMfaOtp('user@example.com', '123456');

    const [mail] = mockSendMail.mock.calls[0];
    expect(mail.subject).toBe('Kod logowania do Zielonego Koszyka');
    expect(mail.html).toContain('Twój kod logowania');
  });

  it('sends the OTP e-mail in English when asked', async () => {
    await service().sendMfaOtp('user@example.com', '123456', 'en');

    const [mail] = mockSendMail.mock.calls[0];
    expect(mail.subject).toBe('Your Zielony Koszyk login code');
    expect(mail.html).toContain('Your login code');
  });

  it.each([
    ['pl', 'Potwierdzenie zamówienia', 'Faktura_7.pdf', 'Dostawa', 'zł'],
    ['en', 'Order confirmation', 'Invoice_7.pdf', 'Delivery', 'PLN'],
  ] as const)(
    'order confirmation follows order.locale=%s (subject, template, attachment, money)',
    async (locale, subject, filename, delivery, currency) => {
      await service().sendOrderConfirmation(order(locale), Buffer.from('pdf'));

      const [, data] = mockMailgunCreate.mock.calls[0] as [
        string,
        {
          subject: string;
          html: string;
          attachment: { filename: string }[];
        },
      ];
      expect(data.subject).toBe(subject);
      expect(data.attachment[0].filename).toBe(filename);
      expect(data.html).toContain(delivery);
      expect(data.html).toContain(currency);
      // Delivery is recognised by item_type, so its quantity is hidden whatever the localized name is.
      expect(data.html).toContain('x2');
      expect(data.html).not.toContain('x1');
    },
  );
});
