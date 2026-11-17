import { Inject, Injectable } from '@nestjs/common';
import { API_CONFIG } from '../../config/config.module';
import type { Environment } from '../../config/environment';

// Singleton shared by all capability adapters; wait time consumes the caller deadline.
@Injectable()
export class AiCapacity {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(@Inject(API_CONFIG) private readonly config: Environment) {}
  async run<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    if (this.active >= this.config.AI_MAX_CONCURRENT_REQUESTS) {
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
