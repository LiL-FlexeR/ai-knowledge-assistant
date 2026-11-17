import { Inject, Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import type { Response } from 'openai/resources/responses/responses';
import { API_CONFIG } from '../../config/config.module';
import type { Environment } from '../../config/environment';
import { ProcessingFailure } from '../../processing-error';
import { AiCapacity } from './ai-capacity';
import { runAiRequest } from './ai-request';
import {
  GroundedAnswerClient,
  groundedOutputSchema,
} from './grounded-answer-client';
import type {
  GroundedPrompt,
  GenerationResult,
} from './grounded-answer-client';
import { generationRequest } from './generation-request';
import { countGenerationTokens } from './generation-tokens';

const invalid = () =>
  new ProcessingFailure('AI_OUTPUT_INVALID', 'Generation response is invalid.');
const usageCount = (count: unknown): number | null =>
  typeof count === 'number' && Number.isSafeInteger(count) && count >= 0
    ? count
    : null;
export function mapGeneration(
  response: Response,
  model: string,
  outputCap: number,
): GenerationResult {
  if (
    !response ||
    response.status !== 'completed' ||
    response.error ||
    response.incomplete_details ||
    response.model !== model ||
    !Array.isArray(response.output) ||
    response.output.some((item) => !item || typeof item !== 'object')
  )
    throw invalid();
  const inputTokens = usageCount(response.usage?.input_tokens);
  const outputTokens = usageCount(response.usage?.output_tokens);
  if (outputTokens !== null && outputTokens > outputCap) throw invalid();
  // A reasoning item is harmless metadata; every other item must be one final message.
  const messages = response.output.filter((item) => item.type !== 'reasoning');
  if (messages.length !== 1 || messages[0]?.type !== 'message') throw invalid();
  const message = messages[0];
  if (
    message.status !== 'completed' ||
    message.role !== 'assistant' ||
    !Array.isArray(message.content) ||
    message.content.length !== 1
  )
    throw invalid();
  const content = message.content[0]!;
  if (!content || typeof content !== 'object') throw invalid();
  if (content.type === 'refusal')
    return { status: 'refused', output: null, inputTokens, outputTokens };
  if (
    content.type !== 'output_text' ||
    typeof content.text !== 'string' ||
    content.text.length > 20000 ||
    countGenerationTokens(content.text) > outputCap
  )
    throw invalid();
  try {
    const output = groundedOutputSchema.parse(JSON.parse(content.text));
    return { status: 'completed', output, inputTokens, outputTokens };
  } catch {
    throw invalid();
  }
}

@Injectable()
export class OpenAIGroundedAnswerClient extends GroundedAnswerClient {
  private readonly sdk: OpenAI | undefined;
  private readonly logger = new Logger(OpenAIGroundedAnswerClient.name);
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
  async generate(
    prompt: GroundedPrompt,
    signal: AbortSignal,
    deadline: number,
  ): Promise<GenerationResult> {
    if (!this.sdk || !this.config.OPENAI_CHAT_MODEL)
      throw new ProcessingFailure(
        'AI_NOT_CONFIGURED',
        'Generation is not configured.',
        true,
      );
    return runAiRequest(
      this.config,
      this.capacity,
      this.logger,
      'ai.generation',
      this.config.OPENAI_CHAT_MODEL,
      signal,
      deadline,
      async (attemptSignal) => {
        const response = await this.sdk!.responses.create(
          generationRequest(prompt, this.config),
          {
            signal: attemptSignal,
            timeout: this.config.AI_REQUEST_TIMEOUT_MS,
            maxRetries: 0,
          },
        );
        return {
          ...mapGeneration(
            response,
            this.config.OPENAI_CHAT_MODEL!,
            this.config.ANSWER_MAX_OUTPUT_TOKENS,
          ),
          requestId: response._request_id,
        };
      },
      (result) => ({
        requestId: result.requestId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      }),
      false,
    );
  }
}
