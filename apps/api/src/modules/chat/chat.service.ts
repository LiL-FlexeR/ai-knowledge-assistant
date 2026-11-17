import { Inject, Injectable } from '@nestjs/common';
import { askRequestSchema, askSchema } from '@aka/shared';
import type { AskResponse } from '@aka/shared';
import { abortable } from '../../abortable';
import { ApiError, invalidRequest } from '../../api-error';
import { API_CONFIG } from '../../config/config.module';
import type { Environment } from '../../config/environment';
import { ProcessingFailure } from '../../processing-error';
import { GroundedAnswerClient } from '../ai/grounded-answer-client';
import { RetrievalService } from '../retrieval/retrieval.service';
import { assembleContext, buildPrompt } from './context';
import { answeredResponse, invalidOutput } from './answer';

@Injectable()
export class ChatService {
  constructor(
    @Inject(API_CONFIG) private readonly config: Environment,
    private readonly retrieval: RetrievalService,
    private readonly generation: GroundedAnswerClient,
  ) {}
  async ask(input: unknown, signal?: AbortSignal): Promise<AskResponse> {
    const parsed = askRequestSchema.safeParse(input);
    if (!parsed.success) throw invalidRequest();
    const { question, topK, documentIds } = parsed.data;
    const controller = new AbortController();
    const timeout = () =>
      new ApiError(
        504,
        'AI_TIMEOUT',
        'Question answering exceeded its deadline.',
      );
    const deadline = Date.now() + this.config.ASK_TIMEOUT_MS;
    const timer = setTimeout(
      () => controller.abort(timeout()),
      this.config.ASK_TIMEOUT_MS,
    );
    const combined = AbortSignal.any([
      controller.signal,
      ...(signal ? [signal] : []),
    ]);
    try {
      combined.throwIfAborted();
      const result = await abortable(
        this.retrieval.retrieve(
          { query: question, topK, documentIds },
          combined,
          deadline,
        ),
        combined,
      );
      const usage: AskResponse['usage'] = {
        embeddingInputTokens: result.embeddingInputTokens,
        generationInputTokens: null,
        generationOutputTokens: null,
      };
      const retrieval = {
        requestedTopK: result.requestedTopK,
        matchedChunks: result.rows.length,
        contextChunks: 0,
      };
      const limitation = (
        reason: AskResponse['reason'],
        message: string,
        status = 'insufficient_context',
      ) =>
        askSchema.parse({
          status,
          reason,
          answer: message,
          limitation: message,
          statements: [],
          citations: [],
          retrieval,
          usage,
        });
      if (result.reason)
        return limitation(
          result.reason,
          result.reason === 'NO_READY_DOCUMENTS'
            ? 'No ready documents are available for this question.'
            : 'No relevant passages were found for this question.',
        );
      const evidence = assembleContext(
        result.rows,
        this.config.CONTEXT_MAX_TOKENS,
      );
      retrieval.contextChunks = evidence.length;
      if (!evidence.length)
        return limitation(
          'EVIDENCE_INSUFFICIENT',
          'No complete evidence spans fit the context budget.',
        );
      if (!this.config.OPENAI_CHAT_MODEL)
        throw new ApiError(
          503,
          'AI_NOT_CONFIGURED',
          'Generation is not configured.',
        );
      const prompt = buildPrompt(question, evidence, this.config);
      combined.throwIfAborted();
      const generated = await abortable(
        this.generation.generate(prompt, combined, deadline),
        combined,
      );
      usage.generationInputTokens = generated.inputTokens;
      usage.generationOutputTokens = generated.outputTokens;
      if (
        generated.outputTokens !== null &&
        generated.outputTokens > this.config.ANSWER_MAX_OUTPUT_TOKENS
      )
        throw invalidOutput();
      if (generated.status === 'refused')
        return limitation(
          'PROVIDER_REFUSAL',
          'The AI provider declined this request.',
          'refused',
        );
      if (generated.status !== 'completed') throw invalidOutput();
      const response = answeredResponse(
        generated.output,
        evidence,
        retrieval,
        usage,
      );
      if (response.citations.length) {
        const used = new Set(
          response.citations.map((citation) => citation.sourceId),
        );
        await abortable(
          this.retrieval.assertUnchanged(
            evidence
              .filter((source) => used.has(source.sourceId))
              .map((source) => source.row),
          ),
          combined,
        );
      }
      combined.throwIfAborted();
      return response;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (combined.aborted) throw timeout();
      if (error instanceof ProcessingFailure) {
        const codes: Record<string, number> = {
          AI_TIMEOUT: 504,
          AI_OUTPUT_INVALID: 502,
          AI_UPSTREAM_ERROR: 502,
          AI_NOT_CONFIGURED: 503,
          AI_CAPACITY_EXCEEDED: 429,
        };
        const status = codes[error.code];
        if (status)
          throw new ApiError(
            status,
            error.code,
            status === 429
              ? 'AI capacity is full. Try again shortly.'
              : status === 504
                ? 'Question answering exceeded its deadline.'
                : 'AI request could not be completed.',
            status === 429 ? 1 : undefined,
          );
      }
      throw new ApiError(
        502,
        'AI_UPSTREAM_ERROR',
        'AI request could not be completed.',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
