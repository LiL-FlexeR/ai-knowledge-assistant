import 'reflect-metadata';
import OpenAI from 'openai';
import { Embeddings } from 'openai/resources/embeddings';
import { parseEnvironment } from '../src/config/environment';
import { AiCapacity } from '../src/modules/ai/ai-capacity';
import {
  embeddingBatches,
  mapEmbeddings,
  OpenAIEmbeddingClient,
  retryableProviderError,
} from '../src/modules/ai/openai-embedding-client';
const basis = (value = 1) => [value, ...Array<number>(1535).fill(0)];
const inputs = [
  { content: 'one', tokenCount: 1 },
  { content: 'two', tokenCount: 1 },
];
const config = parseEnvironment({
  OPENAI_API_KEY: 'fake-unit-test-only',
  AI_REQUEST_TIMEOUT_MS: '100',
});
function response(count = 2) {
  return {
    model: config.OPENAI_EMBEDDING_MODEL,
    data: Array.from({ length: count }, (_, index) => ({
      index,
      embedding: basis(index + 1),
    })).reverse(),
    usage: { prompt_tokens: count },
  };
}
function client(overrides = {}) {
  const local = { ...config, ...overrides };
  return new OpenAIEmbeddingClient(local, new AiCapacity(local));
}
afterEach(() => jest.restoreAllMocks());
it('maps shuffled response indices, never arrival order', () => {
  expect(mapEmbeddings(response().data, 2).map((v) => v[0])).toEqual([1, 2]);
});
it.each([
  [],
  [{ index: 0, embedding: basis() }],
  [
    { index: 0, embedding: basis() },
    { index: 0, embedding: basis() },
  ],
  [
    { index: -1, embedding: basis() },
    { index: 1, embedding: basis() },
  ],
  [
    { index: 0, embedding: [1] },
    { index: 1, embedding: basis() },
  ],
  [
    { index: 0, embedding: basis(NaN) },
    { index: 1, embedding: basis() },
  ],
  [
    { index: 0, embedding: basis(Infinity) },
    { index: 1, embedding: basis() },
  ],
  [
    { index: 0, embedding: basis(0) },
    { index: 1, embedding: basis() },
  ],
  [
    { index: 0, embedding: basis(1e50) },
    { index: 1, embedding: basis() },
  ],
])('rejects missing/duplicate/out-of-range/invalid vectors %#', (...data) => {
  // it.each spreads each row, so preserve each vector-entry row as the response.
  const entries = data.filter(
    (item) => typeof item === 'object' && item !== null,
  ) as { index: number; embedding: number[] }[];
  expect(() => mapEmbeddings(entries, 2)).toThrow(
    expect.objectContaining({ code: 'AI_OUTPUT_INVALID' }),
  );
});
it('batches by both count and aggregate tokens before requests', () => {
  expect(
    embeddingBatches([...inputs, ...inputs], 3).map((batch) => batch.length),
  ).toEqual([3, 1]);
  expect(embeddingBatches(inputs, 32, 1).map((batch) => batch.length)).toEqual([
    1, 1,
  ]);
  expect(() =>
    embeddingBatches([{ content: 'x', tokenCount: 8193 }], 32),
  ).toThrow();
});
it('disables SDK retries, maps usage, batches requests and passes cancellation', async () => {
  const create = jest
    .spyOn(Embeddings.prototype, 'create')
    .mockImplementation(() => Promise.resolve(response(1)) as never);
  const controller = new AbortController();
  const result = await client({ EMBEDDING_BATCH_SIZE: 1 }).embed(
    inputs,
    controller.signal,
    Date.now() + 5000,
  );
  expect(create).toHaveBeenCalledTimes(2);
  expect(create.mock.calls[0]![1]).toMatchObject({
    maxRetries: 0,
    signal: expect.any(AbortSignal),
    timeout: 100,
  });
  expect(result.inputTokens).toBe(2);
  expect(result.vectors).toHaveLength(2);
});
it('retries 429 once with bounded Retry-After and does not retry invalid output/auth', async () => {
  const create = jest
    .spyOn(Embeddings.prototype, 'create')
    .mockRejectedValueOnce(
      new OpenAI.APIError(
        429,
        {},
        'private upstream body',
        new Headers({ 'retry-after': '0' }),
      ),
    )
    .mockImplementation(() => Promise.resolve(response()) as never);
  await expect(
    client().embed(inputs, new AbortController().signal, Date.now() + 5000),
  ).resolves.toMatchObject({ inputTokens: 2 });
  expect(create).toHaveBeenCalledTimes(2);
  create
    .mockReset()
    .mockRejectedValue(
      new OpenAI.APIError(401, {}, 'private key', new Headers()),
    );
  await expect(
    client().embed(inputs, new AbortController().signal, Date.now() + 5000),
  ).rejects.toMatchObject({ code: 'AI_UPSTREAM_ERROR', retryable: false });
  expect(create).toHaveBeenCalledTimes(1);
  create
    .mockReset()
    .mockImplementation(
      () => Promise.resolve({ ...response(), data: [] }) as never,
    );
  await expect(
    client().embed(inputs, new AbortController().signal, Date.now() + 5000),
  ).rejects.toMatchObject({ code: 'AI_OUTPUT_INVALID' });
  expect(create).toHaveBeenCalledTimes(1);
});
it('classifies network/5xx failures, caps retries and refuses attempts outside the whole deadline', async () => {
  expect(retryableProviderError(new OpenAI.APIConnectionError({}))).toBe(true);
  expect(
    retryableProviderError(new OpenAI.APIError(503, {}, 'x', new Headers())),
  ).toBe(true);
  const create = jest
    .spyOn(Embeddings.prototype, 'create')
    .mockRejectedValue(new OpenAI.APIConnectionTimeoutError());
  await expect(
    client({ AI_MAX_RETRIES: 0 }).embed(
      inputs,
      new AbortController().signal,
      Date.now() + 5000,
    ),
  ).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  expect(create).toHaveBeenCalledTimes(1);
  create.mockClear();
  await expect(
    client().embed(inputs, new AbortController().signal, Date.now() + 10),
  ).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  expect(create).not.toHaveBeenCalled();
});
it('has a shared two-call semaphore and removes cancelled waiters', async () => {
  const gate = new AiCapacity(config);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const a = gate.run(new AbortController().signal, () => blocked);
  const b = gate.run(new AbortController().signal, () => blocked);
  const controller = new AbortController();
  const action = jest.fn(async () => 1);
  const c = gate.run(controller.signal, action);
  controller.abort();
  await expect(c).rejects.toBeDefined();
  expect(action).not.toHaveBeenCalled();
  release();
  await Promise.all([a, b]);
  await expect(gate.run(new AbortController().signal, action)).resolves.toBe(1);
});
it('aborts a stalled SDK transport at the per-attempt timeout', async () => {
  const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        const signal = options?.signal;
        signal?.addEventListener(
          'abort',
          () =>
            reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })),
          { once: true },
        );
      }),
  );
  await expect(
    client({ AI_MAX_RETRIES: 0, AI_REQUEST_TIMEOUT_MS: 20 }).embed(
      inputs,
      new AbortController().signal,
      Date.now() + 5000,
    ),
  ).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('bounds semaphore waits by the whole deadline even if the caller does not abort', async () => {
  const capacity = new AiCapacity({ ...config, AI_MAX_CONCURRENT_REQUESTS: 1 });
  let release!: () => void;
  const active = capacity.run(
    new AbortController().signal,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const create = jest.spyOn(Embeddings.prototype, 'create');
  const embedding = new OpenAIEmbeddingClient(config, capacity);
  await expect(
    embedding.embed(inputs, new AbortController().signal, Date.now() + 10),
  ).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  expect(create).not.toHaveBeenCalled();
  release();
  await active;
});
it('bounds the full attempt even when the SDK promise ignores cancellation', async () => {
  jest
    .spyOn(Embeddings.prototype, 'create')
    .mockImplementation(() => new Promise(() => undefined) as never);
  await expect(
    client({ AI_MAX_RETRIES: 0, AI_REQUEST_TIMEOUT_MS: 10 }).embed(
      inputs,
      new AbortController().signal,
      Date.now() + 5000,
    ),
  ).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
});
it('rejects interactive embeddings immediately when shared outbound capacity is full', async () => {
  const capacity = new AiCapacity({ ...config, AI_MAX_CONCURRENT_REQUESTS: 1 });
  let release!: () => void;
  const active = capacity.run(
    new AbortController().signal,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const create = jest.spyOn(Embeddings.prototype, 'create');
  try {
    await expect(
      new OpenAIEmbeddingClient(config, capacity).embed(
        inputs,
        new AbortController().signal,
        Date.now() + 65000,
        { waitForCapacity: false },
      ),
    ).rejects.toMatchObject({ code: 'AI_CAPACITY_EXCEEDED' });
    expect(create).not.toHaveBeenCalled();
  } finally {
    release();
    await active;
  }
});
