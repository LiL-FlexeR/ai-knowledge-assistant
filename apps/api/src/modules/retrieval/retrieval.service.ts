import { Inject, Injectable } from '@nestjs/common';
import { getEncoding } from 'js-tiktoken';
import { searchRequestSchema } from '@aka/shared';
import type { SearchResponse } from '@aka/shared';
import { abortable } from '../../abortable';
import { ApiError, invalidRequest } from '../../api-error';
import { API_CONFIG } from '../../config/config.module';
import type { Environment } from '../../config/environment';
import { serializeVector } from '../../database/vector-sql';
import { ProcessingFailure } from '../../processing-error';
import { EmbeddingClient } from '../ai/embedding-client';
import { VectorReader } from './vector-reader';
import type { VectorRow } from './vector-reader';
import { mapSource } from './source-mapper';

const tokenizer = getEncoding('cl100k_base');
const timeout = () =>
  new ApiError(504, 'AI_TIMEOUT', 'Search exceeded its deadline.');
function publicError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ProcessingFailure) {
    const errors: Record<string, [number, string]> = {
      AI_NOT_CONFIGURED: [503, 'AI is not configured.'],
      AI_UPSTREAM_ERROR: [502, 'Embedding provider request failed.'],
      AI_OUTPUT_INVALID: [502, 'Embedding response is invalid.'],
      AI_TIMEOUT: [504, 'Search exceeded its deadline.'],
      AI_CAPACITY_EXCEEDED: [429, 'AI capacity is full. Try again shortly.'],
    };
    const mapped = errors[error.code];
    if (mapped)
      return new ApiError(
        mapped[0],
        error.code,
        mapped[1],
        mapped[0] === 429 ? 1 : undefined,
      );
  }
  return new ApiError(
    502,
    'AI_UPSTREAM_ERROR',
    'Embedding provider request failed.',
  );
}

@Injectable()
export class RetrievalService {
  constructor(
    @Inject(API_CONFIG) private readonly config: Environment,
    private readonly reader: VectorReader,
    private readonly embeddings: EmbeddingClient,
  ) {}
  async search(input: unknown, signal?: AbortSignal): Promise<SearchResponse> {
    const result = await this.retrieve(input, signal);
    return result.rows.length
      ? { status: 'results', reason: null, results: result.rows.map(mapSource) }
      : { status: 'insufficient_context', reason: result.reason!, results: [] };
  }
  assertUnchanged(sources: readonly VectorRow[]): Promise<void> {
    return this.reader.assertUnchanged(sources);
  }
  async retrieve(
    input: unknown,
    signal?: AbortSignal,
    outerDeadline?: number,
  ): Promise<{
    rows: VectorRow[];
    reason: 'NO_READY_DOCUMENTS' | 'NO_RELEVANT_CONTEXT' | null;
    requestedTopK: number;
    embeddingInputTokens: number | null;
  }> {
    const parsed = searchRequestSchema.safeParse(input);
    if (!parsed.success) throw invalidRequest();
    const { query, documentIds } = parsed.data;
    const topK = parsed.data.topK ?? this.config.RETRIEVAL_TOP_K;
    if (
      query.length > this.config.QUESTION_MAX_CHARS ||
      /[\uD800-\uDFFF]/u.test(query)
    )
      throw invalidRequest();
    const tokenCount = tokenizer.encode(query, [], []).length;
    if (tokenCount > this.config.QUESTION_MAX_TOKENS) throw invalidRequest();
    const controller = new AbortController();
    const deadline = Math.min(
      outerDeadline ?? Infinity,
      Date.now() + this.config.ASK_TIMEOUT_MS,
    );
    const timer = setTimeout(
      () => controller.abort(timeout()),
      Math.max(1, deadline - Date.now()),
    );
    const combined = AbortSignal.any([
      controller.signal,
      ...(signal ? [signal] : []),
    ]);
    try {
      combined.throwIfAborted();
      if (
        !(await abortable(
          this.reader.hasEligibleDocuments(documentIds),
          combined,
        ))
      )
        return {
          reason: 'NO_READY_DOCUMENTS',
          rows: [],
          requestedTopK: topK,
          embeddingInputTokens: 0,
        };
      if (!this.config.OPENAI_API_KEY)
        throw new ApiError(503, 'AI_NOT_CONFIGURED', 'AI is not configured.');
      const embedded = await abortable(
        this.embeddings.embed(
          [{ content: query, tokenCount }],
          combined,
          deadline,
          { waitForCapacity: false },
        ),
        combined,
      );
      let vector: number[];
      try {
        if (embedded.vectors.length !== 1) throw new Error();
        vector = embedded.vectors[0]!;
        serializeVector(vector);
      } catch {
        throw new ApiError(
          502,
          'AI_OUTPUT_INVALID',
          'Embedding response is invalid.',
        );
      }
      const rows = await abortable(
        this.reader.nearest(vector, topK, documentIds),
        combined,
      );
      try {
        const results = rows.filter(
          (row) => 1 - row.distance >= this.config.RETRIEVAL_MIN_SIMILARITY,
        );
        results.forEach(mapSource);
        return {
          rows: results,
          reason: results.length ? null : 'NO_RELEVANT_CONTEXT',
          requestedTopK: topK,
          embeddingInputTokens: embedded.inputTokens,
        };
      } catch {
        throw new ApiError(
          503,
          'SERVICE_UNAVAILABLE',
          'Stored search sources are unavailable.',
        );
      }
    } catch (error) {
      throw publicError(error);
    } finally {
      clearTimeout(timer);
    }
  }
}
