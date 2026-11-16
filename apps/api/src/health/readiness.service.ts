import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Readiness } from '@aka/shared';
import { API_CONFIG } from '../config/config.module';
import type { Environment } from '../config/environment';
import { DatabaseService } from '../database/database.service';
import { StorageProbe } from './storage-probe';

export class ReadinessUnavailable extends ServiceUnavailableException {
  constructor(
    readonly failedChecks: ('database' | 'storage' | 'embeddingProfile')[],
  ) {
    super('Service dependencies are not ready.');
  }
}

@Injectable()
export class ReadinessService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageProbe,
    @Inject(API_CONFIG) private readonly config: Environment,
  ) {}

  async check(): Promise<Readiness> {
    const [database, storage] = await Promise.allSettled([
      this.database.inspect(),
      this.storage.check(),
    ]);
    const failed: ReadinessUnavailable['failedChecks'] = [];
    if (database.status === 'rejected' || !database.value.database) {
      failed.push('database');
    }
    if (database.status === 'fulfilled' && !database.value.embeddingProfile) {
      failed.push('embeddingProfile');
    }
    if (storage.status === 'rejected') failed.push('storage');
    if (failed.length) throw new ReadinessUnavailable(failed);
    return {
      status: 'ready',
      checks: {
        database: 'ok',
        storage: 'ok',
        embeddingProfile: 'ok',
        aiConfiguration: this.config.OPENAI_API_KEY ? 'ok' : 'disabled',
      },
    };
  }
}
