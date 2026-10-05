import { HttpException } from '@nestjs/common';

/**
 * Stable machine-readable codes for errors the frontend shows to users. Clients translate the code; the English
 * `message` stays for developers and logs. Keep in sync with the frontend's `API_ERROR_CODES`.
 */
export enum ErrorCode {
  PRODUCT_NOT_FOUND = 'PRODUCT_NOT_FOUND',
  PRODUCT_DATA_REQUIRED = 'PRODUCT_DATA_REQUIRED',
  FILE_REQUIRED = 'FILE_REQUIRED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  EMAIL_ALREADY_EXISTS = 'EMAIL_ALREADY_EXISTS',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  OLD_PASSWORD_INCORRECT = 'OLD_PASSWORD_INCORRECT',
  ORDER_NOT_FOUND = 'ORDER_NOT_FOUND',
  ORDER_ITEM_NOT_FOUND = 'ORDER_ITEM_NOT_FOUND',
  INVOICE_NOT_FOUND = 'INVOICE_NOT_FOUND',
  INVOICE_FORBIDDEN = 'INVOICE_FORBIDDEN',
  INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK',
}

type ExceptionClass = new (response: string | object) => HttpException;

/**
 * Same exception, same status and same body (`statusCode`, `error`, `message`) as before, plus a `code` field:
 * `throw coded(NotFoundException, ErrorCode.PRODUCT_NOT_FOUND, 'Product not found')`.
 */
export const coded = (
  Exception: ExceptionClass,
  code: ErrorCode,
  message: string,
): HttpException =>
  new Exception({ ...(new Exception(message).getResponse() as object), code });
