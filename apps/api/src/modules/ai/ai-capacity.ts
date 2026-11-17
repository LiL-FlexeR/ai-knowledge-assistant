import { Inject, Injectable } from '@nestjs/common';
import { API_CONFIG } from '../../config/config.module';
import type { Environment } from '../../config/environment';
import { ProcessingFailure } from '../../processing-error';

// Singleton shared by all capability adapters; wait time consumes the caller deadline.
@Injectable()
export class AiCapacity {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(@Inject(API_CONFIG) private readonly config: Environment) {}
  async run<T>(
    signal: AbortSignal,
    action: () => Promise<T>,
    wait = true,
  ): Promise<T> {
    signal.throwIfAborted();
    if (this.active >= this.config.AI_MAX_CONCURRENT_REQUESTS) {
      if (!wait)
        throw new ProcessingFailure(
          'AI_CAPACITY_EXCEEDED',
          'AI capacity is full. Try again shortly.',
          true,
        );
      await new Promise<void>((resolve, reject) => {
        const wake = () => {
          signal.removeEventListener('abort', abort);
          resolve();
        };
        const abort = () => {
          const index = this.waiting.indexOf(wake);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(signal.reason);
        };
        signal.addEventListener('abort', abort, { once: true });
        this.waiting.push(wake);
      });
    } else this.active++;
    try {
      signal.throwIfAborted();
      return await action();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}
