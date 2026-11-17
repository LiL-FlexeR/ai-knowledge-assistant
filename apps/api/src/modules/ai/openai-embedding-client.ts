import { Inject, Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { API_CONFIG } from '../../config/config.module';
import type { Environment } from '../../config/environment';
import { serializeVector } from '../../database/vector-sql';
import { ProcessingFailure } from '../../processing-error';
import { AiCapacity } from './ai-capacity';
import { runAiRequest } from './ai-request';
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
export { retryableProviderError } from './ai-request';

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
    return this.embedBatches(inputs, signal, deadline, options);
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
      const result = await runAiRequest(
        this.config,
        this.capacity,
        this.logger,
        'ai.embedding',
        this.config.OPENAI_EMBEDDING_MODEL,
        signal,
        deadline,
        async (attemptSignal) => {
          const response = await this.sdk!.embeddings.create(
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
          const tokens = Number.isInteger(usage) && usage >= 0 ? usage : null;
          return {
            vectors: mapped,
            inputTokens: tokens,
            requestId: response._request_id,
          };
        },
        (result) => ({
          requestId: result.requestId,
          inputTokens: result.inputTokens,
        }),
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
