// Server-only transport. This module is imported only by the route handler/tests.
export const PROXY_TIMEOUT_MS = 75_000;
export const MULTIPART_LIMIT = 10 * 1024 * 1024 + 64 * 1024;
const localNames = ['localhost', '127.0.0.1', '[::1]'];

type ProxyEnvironment = Readonly<Record<string, string | undefined>>;
export function proxyConfiguration(env: ProxyEnvironment) {
  const origin = new URL(
    env.WEB_ORIGIN || `http://localhost:${env.PORT || '3000'}`,
  );
  const target = new URL(env.API_INTERNAL_URL || 'http://127.0.0.1:3001');
  for (const [url, names] of [
    [origin, localNames],
    [target, [...localNames, 'api']],
  ] as const) {
    if (
      url.protocol !== 'http:' ||
      !names.includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error('Invalid local proxy configuration.');
    }
  }
  return { origin: origin.origin, host: origin.host, target: target.origin };
}

export function proxyError(status: number, code: string, message: string) {
  const requestId = crypto.randomUUID();
  return Response.json(
    { error: { code, message }, requestId },
    {
      status,
      headers: { 'X-Request-Id': requestId, 'Cache-Control': 'no-store' },
    },
  );
}

export async function forwardApi(
  request: Request,
  env: ProxyEnvironment = process.env,
  transport: typeof fetch = fetch,
  timeout = PROXY_TIMEOUT_MS,
): Promise<Response> {
  let config;
  try {
    config = proxyConfiguration(env);
  } catch {
    return proxyError(
      503,
      'PROXY_CONFIGURATION_ERROR',
      'Local API connection is not configured.',
    );
  }
  const url = new URL(request.url);
  if (
    request.headers.get('host') !== config.host ||
    (request.headers.get('origin') &&
      request.headers.get('origin') !== config.origin) ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  ) {
    return proxyError(
      403,
      'ORIGIN_NOT_ALLOWED',
      'Open this application at its configured local address.',
    );
  }
  const path = url.pathname;
  // Never become an arbitrary forward proxy, including encoded path traversal.
  if (
    !/^\/api\/(?:documents(?:\/[\da-f-]{36}(?:\/reprocess)?)?|chat\/ask|search|health(?:\/ready)?)$/i.test(
      path,
    )
  ) {
    return proxyError(404, 'NOT_FOUND', 'API route not found.');
  }
  const limit =
    request.method === 'POST' && path === '/api/documents'
      ? MULTIPART_LIMIT
      : 16 * 1024;
  if (Number(request.headers.get('content-length') || 0) > limit) {
    return proxyError(
      413,
      'PAYLOAD_TOO_LARGE',
      'Request exceeds the upload or JSON size limit.',
    );
  }
  const abort = new AbortController();
  const cancel = () => abort.abort();
  request.signal.addEventListener('abort', cancel, { once: true });
  if (request.signal.aborted) cancel();
  const timer = setTimeout(cancel, timeout);
  const cleanup = () => {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', cancel);
  };
  let exceeded = false;
  let bytes = 0;
  const body = request.body?.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > limit) {
          exceeded = true;
          controller.error(new Error('Body limit.'));
          abort.abort();
        } else controller.enqueue(chunk);
      },
    }),
  );
  const headers = new Headers();
  for (const name of ['content-type', 'origin', 'accept']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const init: RequestInit & { duplex?: 'half' } = {
      method: request.method,
      headers,
      signal: abort.signal,
      cache: 'no-store',
      redirect: 'manual',
      ...(body ? { body, duplex: 'half' as const } : {}),
    };
    const upstream = await transport(
      `${config.target}${path}${url.search}`,
      init,
    );
    const responseHeaders = new Headers({ 'Cache-Control': 'no-store' });
    for (const name of [
      'content-type',
      'x-request-id',
      'retry-after',
      'location',
    ]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    // API responses are bounded public JSON, never originals or model streams.
    const output =
      upstream.status === 204 ? null : await upstream.arrayBuffer();
    return new Response(output, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    if (exceeded)
      return proxyError(
        413,
        'PAYLOAD_TOO_LARGE',
        'Request exceeds the upload or JSON size limit.',
      );
    return abort.signal.aborted
      ? proxyError(
          504,
          'PROXY_TIMEOUT',
          'The local API did not finish in time. Check document status before retrying.',
        )
      : proxyError(
          502,
          'PROXY_UNAVAILABLE',
          'Cannot reach the local API. Check that it is running.',
        );
  } finally {
    cleanup();
  }
}
