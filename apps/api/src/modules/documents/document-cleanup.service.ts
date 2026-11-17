import { Injectable, Logger } from '@nestjs/common';
import type {
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService } from './documents.service';
import { LocalDocumentStore } from './local-document-store';

@Injectable()
export class DocumentCleanupService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer?: NodeJS.Timeout;
  private running: Promise<void> | undefined;
  private readonly logger = new Logger(DocumentCleanupService.name);
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly store: LocalDocumentStore,
  ) {}
  async onApplicationBootstrap(): Promise<void> {
    await this.reconcile();
    this.timer = setInterval(() => {
      void this.reconcile();
    }, 3600000);
    this.timer.unref();
  }
  reconcile(): Promise<void> {
    this.running ??= this.sweep().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async sweep(): Promise<void> {
    const db = this.database.client;
    if (!db) return;
    try {
      const deleting = await db.document.findMany({
        where: { status: 'deleting' },
        select: { id: true },
      });
      for (const row of deleting) {
        await this.documents.delete(row.id).catch(() => {
          this.logger.warn('DELETE_FAILED during document reconciliation.');
        });
      }
      const paths = await db.document.findMany({
        select: { storagePath: true },
      });
      await this.store.cleanupOrphans(
        new Set(paths.map((row) => row.storagePath)),
      );
    } catch {
      this.logger.warn(
        'Document reconciliation unavailable; cleanup will retry.',
      );
    }
  }
  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }
}
