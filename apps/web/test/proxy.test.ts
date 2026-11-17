import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  forwardApi,
  MULTIPART_LIMIT,
  PROXY_TIMEOUT_MS,
  proxyConfiguration,
} from '../lib/proxy';

const env = {
  WEB_ORIGIN: 'http://localhost:3000',
  API_INTERNAL_URL: 'http://127.0.0.1:3001',
};

void test('browser disconnect cancels upstream work without an automatic retry', async () => {
  const controller = new AbortController();
  let calls = 0;
  let cancelled = false;
  const mock = ((_url, init) =>
    new Promise((_resolve, reject) => {
      calls++;
      init?.signal?.addEventListener('abort', () => {
        cancelled = true;
        reject(new Error('disconnected'));
      });
    })) as typeof fetch;
  const result = forwardApi(
    request('/chat/ask', { method: 'POST', signal: controller.signal }),
    env,
    mock,
  );
  controller.abort();
  assert.equal((await result).status, 504);
  assert.equal(cancelled, true);
  assert.equal(calls, 1);
});
function request(path = '/documents', init: RequestInit = {}) {
  return new Request(`http://localhost:3000/api${path}`, {
    ...init,
    headers: {
      host: 'localhost:3000',
      ...Object.fromEntries(new Headers(init.headers)),
    },
  });
}
void test('proxy restricts local target, host, Origin, traversal and cross-site requests', async () => {
  for (const target of [
    'https://api:3001',
    'http://example.com',
    'http://api:3001/path',
    'http://user:pass@api:3001',
  ])
    assert.throws(() =>
      proxyConfiguration({ ...env, API_INTERNAL_URL: target }),
    );
  const mock = (() => {
    throw new Error('must not forward');
  }) as typeof fetch;
  for (const headers of [
    { origin: 'http://evil.test' },
    { host: 'evil.test' },
    { 'sec-fetch-site': 'cross-site' },
  ])
    assert.equal(
      (
        await forwardApi(
          request('/documents', { method: 'DELETE', headers }),
          env,
          mock,
        )
      ).status,
      403,
    );
  assert.equal(
    (await forwardApi(request('/%2e%2e/private'), env, mock)).status,
    404,
  );
});
void test('proxy forwards multipart as a bounded stream, strips forwarded identity and preserves error headers', async () => {
  const form = new FormData();
  form.set('file', new File(['local text'], 'notes.txt'));
  const mock = (async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:3001/api/documents');
    assert.ok(init?.body instanceof ReadableStream);
    const headers = new Headers(init?.headers);
    assert.match(
      headers.get('content-type')!,
      /multipart\/form-data; boundary=/,
    );
    assert.equal(headers.get('x-forwarded-for'), null);
    assert.equal(headers.get('host'), null);
    assert.equal(headers.get('origin'), env.WEB_ORIGIN);
    assert.match(await new Response(init?.body).text(), /local text/);
    return Response.json(
      {
        error: { code: 'CAPACITY_EXCEEDED', message: 'Full.' },
        requestId: 'id',
      },
      { status: 429, headers: { 'X-Request-Id': 'id', 'Retry-After': '8' } },
    );
  }) as typeof fetch;
  const response = await forwardApi(
    request('/documents', {
      method: 'POST',
      body: form,
      headers: { origin: env.WEB_ORIGIN, 'x-forwarded-for': 'untrusted' },
    }),
    env,
    mock,
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '8');
  assert.equal(response.headers.get('x-request-id'), 'id');
  assert.equal((await response.json()).error.code, 'CAPACITY_EXCEEDED');
});
void test('proxy preserves empty 204 and bounds declared and chunked bodies', async () => {
  assert.equal(
    (
      await forwardApi(
        request('/documents', {
          method: 'POST',
          headers: { 'content-length': String(MULTIPART_LIMIT + 1) },
        }),
        env,
      )
    ).status,
    413,
  );
  const consume = (async (_url, init) => {
    await new Response(init?.body).arrayBuffer();
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  assert.equal(
    (
      await forwardApi(
        request('/chat/ask', { method: 'POST', body: 'x'.repeat(16385) }),
        env,
        consume,
      )
    ).status,
    413,
  );
  const empty = await forwardApi(
    request('/documents/11111111-1111-4111-8111-111111111111', {
      method: 'DELETE',
    }),
    env,
    consume,
  );
  assert.equal(empty.status, 204);
  assert.equal(await empty.text(), '');
});
void test('proxy allows 75 seconds for ask and maps transport deadlines/network errors safely', async () => {
  assert.equal(PROXY_TIMEOUT_MS, 75000);
  const hang = ((_url, init) =>
    new Promise((_resolve, reject) =>
      init?.signal?.addEventListener('abort', () =>
        reject(new Error('upstream secret')),
      ),
    )) as typeof fetch;
  const timeout = await forwardApi(
    request('/chat/ask', { method: 'POST' }),
    env,
    hang,
    5,
  );
  assert.equal(timeout.status, 504);
  assert.equal((await timeout.json()).error.code, 'PROXY_TIMEOUT');
  const fail = (async () => {
    throw new Error('internal-secret');
  }) as typeof fetch;
  const unavailable = await forwardApi(request(), env, fail);
  assert.equal(unavailable.status, 502);
  assert.doesNotMatch(await unavailable.text(), /internal-secret/);
});
