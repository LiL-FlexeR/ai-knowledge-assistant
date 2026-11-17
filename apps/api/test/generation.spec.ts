import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { Responses } from 'openai/resources/responses/responses';
import type { Response } from 'openai/resources/responses/responses';
import { Embeddings } from 'openai/resources/embeddings';
import { parseEnvironment } from '../src/config/environment';
import { AiCapacity } from '../src/modules/ai/ai-capacity';
import { GENERATION_MODEL } from '../src/modules/ai/generation-model';
import {
  OpenAIGroundedAnswerClient,
  mapGeneration,
} from '../src/modules/ai/openai-grounded-answer-client';
import { OpenAIEmbeddingClient } from '../src/modules/ai/openai-embedding-client';

const config = () =>
  parseEnvironment({
    OPENAI_API_KEY: 'fake-unit-only',
    OPENAI_CHAT_MODEL: GENERATION_MODEL,
    AI_REQUEST_TIMEOUT_MS: '50',
  });
const prompt = {
  instructions: 'system private-canary',
  input: 'question private-canary',
};
const output = {
  status: 'answered',
  statements: [{ text: 'Supported.', sourceIds: ['S1'] }],
  limitation: null,
};
function response(overrides: object = {}): Response {
  return {
    status: 'completed',
    model: GENERATION_MODEL,
    error: null,
    incomplete_details: null,
    _request_id: 'safe-id',
    output: [
      {
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify(output),
            annotations: [],
          },
        ],
      },
    ],
    usage: { input_tokens: 123, output_tokens: 30 },
    ...overrides,
  } as unknown as Response;
}
const run = (
  client: OpenAIGroundedAnswerClient,
  deadline = Date.now() + 5000,
  signal = new AbortController().signal,
) => client.generate(prompt, signal, deadline);
const client = (overrides = {}) => {
  const local = { ...config(), ...overrides };
  return new OpenAIGroundedAnswerClient(local, new AiCapacity(local));
};
afterEach(() => jest.restoreAllMocks());
it('sends one capped stateless Responses JSON-schema request, no tools/history/streaming, disabled reasoning and SDK retries', async () => {
  const create = jest
    .spyOn(Responses.prototype, 'create')
    .mockImplementation(() => Promise.resolve(response()) as never);
  const log = jest
    .spyOn(Logger.prototype, 'log')
    .mockImplementation(() => undefined);
  const result = await run(client());
  expect(result).toMatchObject({
    status: 'completed',
    output,
    inputTokens: 123,
    outputTokens: 30,
  });
  expect(create).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0]![0]).toMatchObject({
    model: GENERATION_MODEL,
    tools: [],
    tool_choice: 'none',
    store: false,
    stream: false,
    truncation: 'disabled',
    reasoning: { effort: 'none' },
    max_output_tokens: 800,
    text: {
      format: {
        type: 'json_schema',
        strict: true,
        name: 'grounded_answer_v1',
        schema: { additionalProperties: false },
      },
    },
  });
  expect(create.mock.calls[0]![1]).toMatchObject({
    maxRetries: 0,
    timeout: 50,
    signal: expect.any(AbortSignal),
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain('private-canary');
  expect(JSON.stringify(log.mock.calls)).toContain('safe-id');
});
it('maps provider refusal safely without displaying its body; missing usage is null', () => {
  const result = mapGeneration(
    response({
      usage: null,
      output: [
        {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'refusal', refusal: 'private upstream reason' }],
        },
      ],
    }),
    GENERATION_MODEL,
    800,
  );
  expect(result).toEqual({
    status: 'refused',
    output: null,
    inputTokens: null,
    outputTokens: null,
  });
});
it.each([
  { output: [null] },
  {
    output: [
      {
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: null,
      },
    ],
  },
  {
    output: [
      {
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [null],
      },
    ],
  },
  { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
  { status: 'failed' },
  { model: 'wrong-model' },
  { output: [] },
  { output: [{ type: 'function_call', name: 'execute', arguments: '{}' }] },
  {
    output: [
      { type: 'message', role: 'assistant', status: 'incomplete', content: [] },
    ],
  },
  {
    output: [
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: '{bad' }],
      },
    ],
  },
  {
    output: [
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [
          { type: 'output_text', text: JSON.stringify({ ...output, page: 3 }) },
        ],
      },
    ],
  },
  { usage: { input_tokens: 1, output_tokens: 801 } },
])(
  'rejects incomplete/truncated/malformed/tool/oversized responses without regeneration %#',
  async (overrides) => {
    const create = jest
      .spyOn(Responses.prototype, 'create')
      .mockImplementation(() => Promise.resolve(response(overrides)) as never);
    await expect(run(client())).rejects.toMatchObject({
      code: 'AI_OUTPUT_INVALID',
    });
    expect(create).toHaveBeenCalledTimes(1);
  },
);
it('retries transient 429 once; auth and invalid output never retry', async () => {
  const create = jest
    .spyOn(Responses.prototype, 'create')
    .mockRejectedValueOnce(
      new OpenAI.APIError(
        429,
        {},
        'private response',
        new Headers({ 'retry-after': '0' }),
      ),
    )
    .mockImplementation(() => Promise.resolve(response()) as never);
  await expect(run(client())).resolves.toMatchObject({ status: 'completed' });
  expect(create).toHaveBeenCalledTimes(2);
  create
    .mockReset()
    .mockRejectedValue(
      new OpenAI.APIError(401, {}, 'private credentials', new Headers()),
    );
  await expect(run(client())).rejects.toMatchObject({
    code: 'AI_UPSTREAM_ERROR',
    retryable: false,
  });
  expect(create).toHaveBeenCalledTimes(1);
});
it('caps transport attempts at three and refuses retry/backoff when a full attempt cannot fit', async () => {
  const create = jest
    .spyOn(Responses.prototype, 'create')
    .mockRejectedValue(new OpenAI.APIConnectionError({}));
  await expect(run(client())).rejects.toMatchObject({
    code: 'AI_UPSTREAM_ERROR',
  });
  expect(create).toHaveBeenCalledTimes(3);
  create.mockClear();
  await expect(run(client(), Date.now() + 49)).rejects.toMatchObject({
    code: 'AI_TIMEOUT',
  });
  expect(create).not.toHaveBeenCalled();
  create.mockRejectedValue(
    new OpenAI.APIError(
      429,
      {},
      'private',
      new Headers({ 'retry-after': '9999' }),
    ),
  );
  await expect(run(client(), Date.now() + 100)).rejects.toMatchObject({
    code: 'AI_TIMEOUT',
  });
  expect(create).toHaveBeenCalledTimes(1);
});
it('aborts per-attempt timeout and cancellation even if transport ignores its signal', async () => {
  const create = jest
    .spyOn(Responses.prototype, 'create')
    .mockImplementation(() => new Promise(() => undefined) as never);
  await expect(run(client({ AI_MAX_RETRIES: 0 }))).rejects.toMatchObject({
    code: 'AI_TIMEOUT',
  });
  expect(create.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  const controller = new AbortController();
  const pending = run(client(), Date.now() + 5000, controller.signal);
  controller.abort(new Error('cancelled'));
  await expect(pending).rejects.toThrow('cancelled');
});
it('shares capacity with embeddings and rejects full interactive generation without a provider call', async () => {
  const local = { ...config(), AI_MAX_CONCURRENT_REQUESTS: 1 };
  const capacity = new AiCapacity(local);
  let release!: () => void;
  jest.spyOn(Embeddings.prototype, 'create').mockImplementation(
    () =>
      new Promise((resolve) => {
        release = () =>
          resolve({
            model: local.OPENAI_EMBEDDING_MODEL,
            data: [
              { index: 0, embedding: [1, ...Array<number>(1535).fill(0)] },
            ],
            usage: { prompt_tokens: 1 },
          });
      }) as never,
  );
  const create = jest
    .spyOn(Responses.prototype, 'create')
    .mockImplementation(() => Promise.resolve(response()) as never);
  const embedded = new OpenAIEmbeddingClient(
    { ...local, AI_REQUEST_TIMEOUT_MS: 1000 },
    capacity,
  ).embed(
    [{ content: 'one', tokenCount: 1 }],
    new AbortController().signal,
    Date.now() + 5000,
  );
  await expect(
    run(new OpenAIGroundedAnswerClient(local, capacity)),
  ).rejects.toMatchObject({ code: 'AI_CAPACITY_EXCEEDED' });
  expect(create).not.toHaveBeenCalled();
  release();
  await embedded;
  await expect(
    run(new OpenAIGroundedAnswerClient(local, capacity)),
  ).resolves.toMatchObject({ status: 'completed' });
});
it('requires the reviewed model and key without calling the provider', async () => {
  expect(() =>
    parseEnvironment({ OPENAI_CHAT_MODEL: 'unreviewed-model' }),
  ).toThrow('OPENAI_CHAT_MODEL');
  const create = jest.spyOn(Responses.prototype, 'create');
  await expect(
    run(client({ OPENAI_CHAT_MODEL: undefined })),
  ).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
  await expect(
    run(client({ OPENAI_API_KEY: undefined })),
  ).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
  expect(create).not.toHaveBeenCalled();
});
it('enforces raw output-token limits even when provider usage is unavailable', () => {
  expect(() =>
    mapGeneration(response({ usage: null }), GENERATION_MODEL, 1),
  ).toThrow(expect.objectContaining({ code: 'AI_OUTPUT_INVALID' }));
});
