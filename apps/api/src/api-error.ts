import { HttpException } from '@nestjs/common';

// Only server-authored messages enter the public error envelope.
export class ApiError extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    readonly safeMessage: string,
    readonly retryAfter?: number,
  ) {
    super(safeMessage, status);
  }
}

export const invalidRequest = () =>
  new ApiError(400, 'VALIDATION_ERROR', 'Invalid request.');
export const storageError = () =>
  new ApiError(500, 'STORAGE_ERROR', 'Document storage is unavailable.');
