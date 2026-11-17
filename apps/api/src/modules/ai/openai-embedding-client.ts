import { setTimeout as delay } from 'node:timers/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { abortable } from '../../abortable';
import { API_CONFIG } from '../../config/config.module';
import type { Environment } from '../../config/environment';
import { serializeVector } from '../../database/vector-sql';
import { ProcessingFailure } from '../../processing-error';
import { AiCapacity } from './ai-capacity';
import { EmbeddingClient } from './embedding-client';
import type {
  EmbeddingInput,
  EmbeddingResult,
  EmbeddingOptions,
} from './embedding-client';

export const PROVIDER_TOKEN_CAP = 300000;
export function embeddingBatches(
  inputs: EmbeddingInput[],
  size: number,
  cap = PROVIDER_TOKEN_CAP,
): EmbeddingInput[][] {
  const batches: EmbeddingInput[][] = [];
  let batch: EmbeddingInput[] = [];
  let tokens = 0;
  for (const input of inputs) {
    if (
      !input.content.trim() ||
      !Number.isInteger(input.tokenCount) ||
      input.tokenCount < 1 ||
      input.tokenCount > 8192 ||
      input.tokenCount > cap
    )
      throw new ProcessingFailure(
        'AI_OUTPUT_INVALID',
        'Embedding input exceeds provider limits.',
      );
    if (
      batch.length &&
      (batch.length >= size || tokens + input.tokenCount > cap)
    ) {
      batches.push(batch);
      batch = [];
      tokens = 0;
    }
    batch.push(input);
    tokens += input.tokenCount;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
export function mapEmbeddings(
  data: { index: number; embedding: number[] }[],
  count: number,
): number[][] {
  try {
    if (data.length !== count) throw new Error();
    const vectors: number[][] = Array(count);
    for (const item of data) {
      if (
        !Number.isInteger(item.index) ||
        item.index < 0 ||
        item.index >= count ||
        vectors[item.index]
      )
        throw new Error();
      serializeVector(item.embedding);
      vectors[item.index] = item.embedding;
    }
    return vectors;
  } catch {
    throw new ProcessingFailure(
      'AI_OUTPUT_INVALID',
      'Embedding response is invalid.',
    );
  }
}
export function retryableProviderError(error: unknown): boolean {
  return (
    error instanceof OpenAI.APIConnectionError ||
    (error instanceof OpenAI.APIError &&
      (error.status === 429 ||
        (error.status !== undefined && error.status >= 500)))
  );
}
function timeout(): ProcessingFailure {
  return new ProcessingFailure(
    'AI_TIMEOUT',
    'Embedding operation exceeded its deadline.',
    true,
  );
}

@Injectable()
export class OpenAIEmbeddingClient extends EmbeddingClient {
  private readonly sdk: OpenAI | undefined;
  private readonly logger = new Logger(OpenAIEmbeddingClient.name);
  constructor(
    @Inject(API_CONFIG) private readonly config: Environment,
    private readonly capacity: AiCapacity,
  ) {
    super();
    this.sdk = config.OPENAI_API_KEY
      ? new OpenAI({
          apiKey: config.OPENAI_API_KEY,
          maxRetries: 0,
          logLevel: 'off',
          timeout: config.AI_REQUEST_TIMEOUT_MS,
        })
      : undefined;
  }
  async embed(
    inputs: EmbeddingInput[],
    signal: AbortSignal,
    deadline: number,
    options: EmbeddingOptions = {},
  ): Promise<EmbeddingResult> {
    if (!this.sdk)
      throw new ProcessingFailure(
        'AI_NOT_CONFIGURED',
        'AI is not configured.',
        true,
      );
    const operation = new AbortController();
    const timer = setTimeout(
      () => operation.abort(timeout()),
      Math.max(1, deadline - Date.now()),
    );
    const combined = AbortSignal.any([signal, operation.signal]);
    try {
      return await this.embedBatches(inputs, combined, deadline, options);
    } finally {
      clearTimeout(timer);
    }
  }
  private async embedBatches(
    inputs: EmbeddingInput[],
    signal: AbortSignal,
    deadline: number,
    options: EmbeddingOptions,
  ): Promise<EmbeddingResult> {
    const vectors: number[][] = [];
    let inputTokens: number | null = 0;
    for (const batch of embeddingBatches(
      inputs,
      this.config.EMBEDDING_BATCH_SIZE,
    )) {
      const result = await this.capacity.run(
        signal,
        async () => {
          const started = Date.now();
          for (let attempt = 0; ; attempt++) {
            signal.throwIfAborted();
            // Never begin an attempt whose full timeout cannot fit.
            if (Date.now() + this.config.AI_REQUEST_TIMEOUT_MS > deadline)
              throw timeout();
            const attemptController = new AbortController();
            const attemptSignal = AbortSignal.any([
              signal,
              attemptController.signal,
            ]);
            const attemptTimer = setTimeout(
              () => attemptController.abort(timeout()),
              this.config.AI_REQUEST_TIMEOUT_MS,
            );
            try {
              const response = await abortable(
                this.sdk!.embeddings.create(
                  {
                    model: this.config.OPENAI_EMBEDDING_MODEL,
                    dimensions: this.config.EMBEDDING_DIMENSIONS,
                    input: batch.map((input) => input.content),
                    encoding_format: 'float',
                  },
                  {
                    signal: attemptSignal,
                    timeout: this.config.AI_REQUEST_TIMEOUT_MS,
                    maxRetries: 0,
                  },
                ),
                attemptSignal,
              );
              if (
                !response ||
                response.model !== this.config.OPENAI_EMBEDDING_MODEL ||
                !Array.isArray(response.data)
              )
                throw new ProcessingFailure(
                  'AI_OUTPUT_INVALID',
                  'Embedding model does not match the active profile.',
                );
              const mapped = mapEmbeddings(response.data, batch.length);
              const usage = response.usage?.prompt_tokens;
              const tokens =
                Number.isInteger(usage) && usage >= 0 ? usage : null;
              this.logger.log({
                operation: 'ai.embedding',
                provider: 'openai',
                model: this.config.OPENAI_EMBEDDING_MODEL,
                requestId: response._request_id,
                attempts: attempt + 1,
                inputTokens: tokens,
                latencyMs: Date.now() - started,
              });
              return { vectors: mapped, inputTokens: tokens };
            } catch (error) {
              if (signal.aborted) throw signal.reason;
              const timedOut =
                attemptController.signal.aborted ||
                error instanceof OpenAI.APIConnectionTimeoutError;
              if (error instanceof ProcessingFailure && !timedOut) throw error;
              this.logger.warn({
                operation: 'ai.embedding',
                model: this.config.OPENAI_EMBEDDING_MODEL,
                attempt: attempt + 1,
                code: timedOut ? 'AI_TIMEOUT' : 'AI_UPSTREAM_ERROR',
                latencyMs: Date.now() - started,
              });
              if (
                (!timedOut && !retryableProviderError(error)) ||
                attempt >= this.config.AI_MAX_RETRIES
              )
                throw timedOut
                  ? timeout()
                  : new ProcessingFailure(
                      'AI_UPSTREAM_ERROR',
                      'Embedding provider request failed.',
                      retryableProviderError(error),
                    );
              const header =
                error instanceof OpenAI.APIError
                  ? error.headers?.get('retry-after')
                  : null;
              const seconds = header ? Number(header) : NaN;
              const retryAt = header ? Date.parse(header) : NaN;
              const requested = Number.isFinite(seconds)
                ? seconds * 1000
                : Number.isFinite(retryAt)
                  ? retryAt - Date.now()
                  : 0;
              const backoff = Math.max(
                500 * 2 ** attempt + Math.floor(Math.random() * 100),
                Math.min(5000, Math.max(0, requested)),
              );
              if (
                Date.now() + backoff + this.config.AI_REQUEST_TIMEOUT_MS >
                deadline
              )
                throw timeout();
              await delay(backoff, undefined, { signal });
            } finally {
              clearTimeout(attemptTimer);
            }
          }
        },
        options.waitForCapacity,
      );
      vectors.push(...result.vectors);
      inputTokens =
        inputTokens === null || result.inputTokens === null
          ? null
          : inputTokens + result.inputTokens;
    }
    return { vectors, inputTokens };
  }
}
