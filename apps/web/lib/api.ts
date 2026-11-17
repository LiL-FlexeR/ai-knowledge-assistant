import {
  askRequestSchema,
  askResponseSchema,
  documentListResponseSchema,
  documentResponseSchema,
  errorResponseSchema,
} from '@aka/shared';
import type { AskRequest } from '@aka/shared';
import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 0,
    public readonly requestId: string | null = null,
    public readonly retryAfter: number | null = null,
  ) {
    super(message);
  }
}

export async function apiRequest<T>(
  path: string,
  schema: z.ZodType<T> | null,
  init: RequestInit = {},
  transport: typeof fetch = fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await transport(`/api${path}`, {
      ...init,
      cache: 'no-store',
      signal: init.signal ?? AbortSignal.timeout(78_000),
    });
  } catch {
    throw new ApiError(
      'NETWORK_ERROR',
      'Connection interrupted. Check the local API and document status before retrying.',
    );
  }
  const headerId = response.headers.get('x-request-id');
  const retry = response.headers.get('retry-after');
  const retryAfter = retry && /^\d+$/.test(retry) ? Number(retry) : null;
  if (response.status === 204 && !schema) return undefined as T;
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiError(
      'INVALID_RESPONSE',
      'The local API returned an unreadable response.',
      response.status,
      headerId,
    );
  }
  if (!response.ok) {
    const result = errorResponseSchema.safeParse(json);
    if (result.success)
      throw new ApiError(
        result.data.error.code,
        result.data.error.message,
        response.status,
        result.data.requestId,
        retryAfter,
      );
    throw new ApiError(
      'INVALID_RESPONSE',
      'The local API returned an unexpected error.',
      response.status,
      headerId,
      retryAfter,
    );
  }
  const result = schema?.safeParse(json);
  if (!result?.success)
    throw new ApiError(
      'INVALID_RESPONSE',
      'The local API response did not match its contract.',
      response.status,
      headerId,
    );
  return result.data;
}

export const api = {
  list: (cursor: string | undefined, signal: AbortSignal) =>
    apiRequest(
      `/documents?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      documentListResponseSchema,
      { signal },
    ),
  detail: (id: string, signal: AbortSignal) =>
    apiRequest(`/documents/${id}`, documentResponseSchema, { signal }),
  upload: (file: File) => {
    const body = new FormData();
    body.set('file', file);
    return apiRequest('/documents', documentResponseSchema, {
      method: 'POST',
      body,
    });
  },
  remove: (id: string) =>
    apiRequest<void>(`/documents/${id}`, null, { method: 'DELETE' }),
  reprocess: (id: string) =>
    apiRequest(`/documents/${id}/reprocess`, documentResponseSchema, {
      method: 'POST',
    }),
  ask: (body: AskRequest) =>
    apiRequest('/chat/ask', askResponseSchema, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(askRequestSchema.parse(body)),
    }),
};
