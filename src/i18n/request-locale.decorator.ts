import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { Locale, resolveLocale } from './locale';

/** Controller parameter: the request's content language, resolved from `Accept-Language`. */
export const RequestLocale = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Locale =>
    resolveLocale(
      context.switchToHttp().getRequest<Request>().headers['accept-language'],
    ),
);
