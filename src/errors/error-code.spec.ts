import { NotFoundException } from '@nestjs/common';
import { coded, ErrorCode } from './error-code';

describe('coded', () => {
  it('keeps the status and the usual body, and adds a machine-readable code', () => {
    const error = coded(
      NotFoundException,
      ErrorCode.PRODUCT_NOT_FOUND,
      'Product not found',
    );

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Product not found',
      code: 'PRODUCT_NOT_FOUND',
    });
  });
});
