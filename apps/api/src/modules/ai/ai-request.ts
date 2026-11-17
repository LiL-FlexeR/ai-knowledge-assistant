import { setTimeout as delay } from 'node:timers/promises';
import type { Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { abortable } from '../../abortable';
import type { Environment } from '../../config/environment';
import { ProcessingFailure } from '../../processing-error';
import type { AiCapacity } from './ai-capacity';
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
    'AI operation exceeded its deadline.',
    true,
  );
}

export async function runAiRequest<T>(
  config: Environment,
  capacity: AiCapacity,
  logger: Logger,
  operation: string,
  model: string,
  signal: AbortSignal,
  deadline: number,
  action: (attemptSignal: AbortSignal) => Promise<T>,
  telemetry: (result: T) => {
    requestId?: string | null | undefined;
    inputTokens: number | null;
    outputTokens?: number | null;
  },
  waitForCapacity = true,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(timeout()),
    Math.max(1, deadline - Date.now()),
  );
  signal = AbortSignal.any([signal, controller.signal]);
  try {
    return await capacity.run(
      signal,
      async () => {
        const started = Date.now();
        for (let attempt = 0; ; attempt++) {
          signal.throwIfAborted();
          // Never begin an attempt whose full timeout cannot fit.
          if (Date.now() + config.AI_REQUEST_TIMEOUT_MS > deadline)
            throw timeout();
          const attemptController = new AbortController();
          const attemptSignal = AbortSignal.any([
            signal,
            attemptController.signal,
          ]);
          const attemptTimer = setTimeout(
            () => attemptController.abort(timeout()),
            config.AI_REQUEST_TIMEOUT_MS,
          );
          try {
            const response = await abortable(
              action(attemptSignal),
              attemptSignal,
            );
            const fields = telemetry(response);
            logger.log({
              operation,
              provider: 'openai',
              model,
              ...fields,
              attempts: attempt + 1,
              latencyMs: Date.now() - started,
            });
            return response;
          } catch (error) {
            if (signal.aborted) throw signal.reason;
            const timedOut =
              attemptController.signal.aborted ||
              error instanceof OpenAI.APIConnectionTimeoutError;
            if (error instanceof ProcessingFailure && !timedOut) throw error;
            logger.warn({
              operation,
              model,
              attempt: attempt + 1,
              code: timedOut ? 'AI_TIMEOUT' : 'AI_UPSTREAM_ERROR',
              latencyMs: Date.now() - started,
            });
            if (
              (!timedOut && !retryableProviderError(error)) ||
              attempt >= config.AI_MAX_RETRIES
            )
              throw timedOut
                ? timeout()
                : new ProcessingFailure(
                    'AI_UPSTREAM_ERROR',
                    'AI provider request failed.',
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
            if (Date.now() + backoff + config.AI_REQUEST_TIMEOUT_MS > deadline)
              throw timeout();
            await delay(backoff, undefined, { signal });
          } finally {
            clearTimeout(attemptTimer);
          }
        }
      },
      waitForCapacity,
    );
  } finally {
    clearTimeout(timer);
  }
}
