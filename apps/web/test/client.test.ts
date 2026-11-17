import { test } from 'node:test';
import assert from 'node:assert/strict';
import { healthResponseSchema } from '@aka/shared';
import { apiRequest } from '../lib/api';
import type { ApiError } from '../lib/api';
import { uploadSchema } from '../lib/forms';
import { fileSize, pollingInterval, sourceLabel } from '../lib/presentation';
import type { DocumentDTO } from '@aka/shared';

const requestId = '11111111-1111-4111-8111-111111111111';
const transport = (response: Response) =>
  (async () => response) as typeof fetch;
void test('client consumes envelopes, empty 204, errors and Retry-After safely', async () => {
  const result = await apiRequest(
    '/health',
    healthResponseSchema,
    {},
    transport(Response.json({ data: { status: 'ok' }, requestId })),
  );
  assert.equal(result.requestId, requestId);
  assert.equal(
    await apiRequest(
      '/documents/id',
      null,
      {},
      transport(new Response(null, { status: 204 })),
    ),
    undefined,
  );
  await assert.rejects(
    apiRequest(
      '/chat/ask',
      healthResponseSchema,
      {},
      transport(
        Response.json(
          {
            error: { code: 'AI_CAPACITY_EXCEEDED', message: 'Try later.' },
            requestId,
          },
          { status: 429, headers: { 'Retry-After': '12' } },
        ),
      ),
    ),
    (error: ApiError) =>
      error.status === 429 &&
      error.requestId === requestId &&
      error.retryAfter === 12,
  );
  await assert.rejects(
    apiRequest(
      '/health',
      healthResponseSchema,
      {},
      transport(Response.json({ data: 'invalid', requestId })),
    ),
    (error: ApiError) => error.code === 'INVALID_RESPONSE',
  );
  await assert.rejects(
    apiRequest(
      '/health',
      healthResponseSchema,
      {},
      transport(new Response('SECRET', { status: 502 })),
    ),
    (error: ApiError) => !error.message.includes('SECRET'),
  );
});
void test('client uses relative same-origin paths and sends a paid POST only once on failure', async () => {
  let calls = 0;
  const mock = (async (url: string | URL | Request) => {
    calls++;
    assert.equal(url, '/api/chat/ask');
    throw new Error('secret provider details');
  }) as typeof fetch;
  await assert.rejects(
    apiRequest('/chat/ask', null, { method: 'POST' }, mock),
    (error: ApiError) =>
      error.code === 'NETWORK_ERROR' && !error.message.includes('secret'),
  );
  assert.equal(calls, 1);
});
void test('upload bounds reject absent, empty, unsupported and oversized files', () => {
  for (const file of [
    undefined,
    new File([], 'empty.txt'),
    new File(['x'], 'bad.exe'),
    new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.txt'),
  ])
    assert.equal(uploadSchema.safeParse({ file }).success, false);
  assert.equal(
    uploadSchema.safeParse({ file: new File(['# Policy'], 'policy.MD') })
      .success,
    true,
  );
});
void test('source labels distinguish physical pages and original section/lines', () => {
  assert.equal(fileSize(49), '49 B');
  const span = { unitIndex: 0, charStart: 0, charEnd: 10 };
  assert.equal(
    sourceLabel({ kind: 'pdf', page: 2, ...span }),
    'Physical page 2',
  );
  assert.equal(
    sourceLabel({
      kind: 'text',
      sectionOrdinal: 1,
      lineStart: 2,
      lineEnd: 4,
      ...span,
    }),
    'Section 1 · Lines 2–4',
  );
  assert.equal(
    sourceLabel({
      kind: 'markdown',
      sectionOrdinal: 2,
      headingPath: ['Policy', 'Recovery'],
      lineStart: 4,
      lineEnd: 4,
      ...span,
    }),
    'Policy / Recovery · Line 4',
  );
});
void test('polling stops for terminal/offscreen/hidden/offline states and backs off errors', () => {
  const doc = { status: 'pending' } as DocumentDTO;
  assert.equal(pollingInterval(doc, 0, true), 2000);
  assert.equal(pollingInterval(doc, 3, true), 16000);
  assert.equal(pollingInterval(doc, 10, true), 30000);
  assert.equal(pollingInterval(doc, 1, true, 60), 60000);
  assert.equal(pollingInterval(doc, 0, false), false);
  for (const status of ['ready', 'failed'] as const)
    assert.equal(pollingInterval({ ...doc, status }, 0, true), false);
});
