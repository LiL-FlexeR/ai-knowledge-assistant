import { extname } from 'node:path';
import { ApiError } from '../../api-error';

export function sanitizeFilename(input: string): string {
  const basename = input.replaceAll('\\', '/').split('/').at(-1) ?? '';
  // Remove control/bidi characters; truncate without splitting a surrogate pair.
  const cleaned = basename.replace(/[\p{Cc}\p{Cf}/\\]/gu, '').trim();
  const extension = extname(cleaned);
  const suffix = /^\.(pdf|txt|md|markdown)$/i.test(extension) ? extension : '';
  const stem = suffix ? cleaned.slice(0, -suffix.length) : cleaned;
  const result =
    stem.slice(0, 255 - suffix.length).replace(/[\uD800-\uDBFF]$/u, '') +
    suffix;
  return result && result !== '.' && result !== '..' ? result : 'document';
}

export function validateFormat(
  filename: string,
  claimed: string,
  bytes: Buffer,
) {
  const extension = extname(filename).toLowerCase().slice(1);
  const mimeType =
    extension === 'pdf'
      ? 'application/pdf'
      : extension === 'txt'
        ? 'text/plain'
        : ['md', 'markdown'].includes(extension)
          ? 'text/markdown'
          : undefined;
  const unsupported = () =>
    new ApiError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Unsupported or conflicting document format.',
    );
  if (!mimeType) throw unsupported();
  const mime = claimed.split(';')[0]?.trim().toLowerCase();
  if (mime && mime !== 'application/octet-stream' && mime !== mimeType)
    throw unsupported();
  if (mimeType === 'application/pdf') {
    if (
      !/^%PDF-\d\.\d(?:\r|\n|\s)/.test(bytes.subarray(0, 16).toString('latin1'))
    )
      throw unsupported();
  } else {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new ApiError(
        422,
        'INVALID_DOCUMENT',
        'Document must contain valid UTF-8 text.',
      );
    }
    let binary = false;
    for (const character of text) {
      const code = character.codePointAt(0)!;
      if (
        (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
        (code >= 127 && code <= 159)
      ) {
        binary = true;
        break;
      }
    }
    if (!text.trim() || binary) {
      throw new ApiError(
        422,
        'INVALID_DOCUMENT',
        'Document must contain nonempty, nonbinary UTF-8 text.',
      );
    }
    if (bytes.subarray(0, 5).toString() === '%PDF-') throw unsupported();
  }
  return { extension, mimeType };
}
