import Handlebars from 'handlebars';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Locale } from '../i18n/locale';

export type MailTemplate =
  | 'mfa-otp'
  | 'order-confirmation'
  | 'welcome-email-created-user';

/** Templates are separate files per language (`<name>.<locale>.hbs`), so copy differences never become conditionals. */
export const templateFileName = (template: MailTemplate, locale: Locale) =>
  `${template}.${locale}.hbs`;

/** `dist/constants` once built (assets are copied beside `dist/src`), `src/constants` when run from source. */
const TEMPLATE_DIRS = [
  path.join(__dirname, '../../constants'),
  path.join(__dirname, '../constants'),
];

const readTemplate = (file: string): string => {
  for (const [index, dir] of TEMPLATE_DIRS.entries()) {
    try {
      return fs.readFileSync(path.join(dir, file), 'utf8');
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
      if (!missing || index === TEMPLATE_DIRS.length - 1) throw error;
    }
  }
  throw new Error(`Mail template not found: ${file}`);
};

export const renderMailTemplate = (
  template: MailTemplate,
  locale: Locale,
  context: Record<string, unknown>,
): string =>
  Handlebars.compile(readTemplate(templateFileName(template, locale)))(context);
