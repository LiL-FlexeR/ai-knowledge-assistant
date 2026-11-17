export class ProcessingFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
  }
}
export function interrupted(): ProcessingFailure {
  return new ProcessingFailure(
    'PROCESSING_INTERRUPTED',
    'Processing was interrupted. Reprocess to retry.',
    true,
  );
}
export function limitExceeded(): ProcessingFailure {
  return new ProcessingFailure(
    'EXTRACTION_LIMIT_EXCEEDED',
    'Document exceeds an extraction or token limit.',
  );
}
