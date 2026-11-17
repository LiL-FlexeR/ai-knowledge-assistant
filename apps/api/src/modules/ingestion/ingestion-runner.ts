import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  BeforeApplicationShutdown,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { abortable } from '../../abortable';
import { API_CONFIG } from '../../config/config.module';
import type { Environment } from '../../config/environment';
import { DatabaseService } from '../../database/database.service';
import { LocalDocumentStore } from '../documents/local-document-store';
import { DocumentWorkSignals } from '../documents/document-work-signals';
import { EmbeddingClient } from '../ai/embedding-client';
import { ExtractionService } from './extraction.service';
import { IngestionPersistence } from './ingestion-persistence';
import { interrupted, ProcessingFailure } from '../../processing-error';

@Injectable()
export class IngestionRunner
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private timer?: NodeJS.Timeout;
  private running: Promise<void> | undefined;
  private controller: AbortController | undefined;
  private stopped = false;
  private recovered = false;
  private readonly logger = new Logger(IngestionRunner.name);
  constructor(
    @Inject(API_CONFIG) private readonly config: Environment,
    private readonly database: DatabaseService,
    private readonly store: LocalDocumentStore,
    private readonly work: DocumentWorkSignals,
    private readonly extractor: ExtractionService,
    private readonly embeddings: EmbeddingClient,
    private readonly persistence: IngestionPersistence,
  ) {}
  async onApplicationBootstrap(): Promise<void> {
    // Recovery also runs with disabled AI; pending work waits for configuration.
    try {
      await this.persistence.recover();
      this.recovered = true;
    } catch {
      this.logger.warn('Ingestion recovery unavailable; scanner will retry.');
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.INGESTION_POLL_MS);
    this.timer.unref();
  }
  tick(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.running ??= this.scan()
      .catch(() => {
        this.logger.warn(
          'Ingestion scanner unavailable; pending work remains durable.',
        );
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
  private async scan(): Promise<void> {
    if (!this.recovered) {
      await this.persistence.recover();
      this.recovered = true;
    }
    if (!this.config.OPENAI_API_KEY || !this.database.client || this.stopped)
      return;
    const readiness = await this.database.inspect();
    if (!readiness.database || !readiness.embeddingProfile || this.stopped)
      return;
    const document = await this.persistence.claim();
    if (!document) return;
    const controller = new AbortController();
    this.controller = controller;
    const unregister = this.work.register(
      document.id,
      document.processingRunId,
      controller,
    );
    if (this.stopped) controller.abort(interrupted());
    const started = Date.now();
    const deadline = started + this.config.INGESTION_TIMEOUT_MS;
    const timeout = setTimeout(
      () =>
        controller.abort(
          new ProcessingFailure(
            'AI_TIMEOUT',
            'Processing exceeded its whole-run deadline.',
            true,
          ),
        ),
      this.config.INGESTION_TIMEOUT_MS,
    );
    this.logger.log({
      operation: 'ingestion',
      documentId: document.id,
      status: 'processing',
    });
    try {
      // Close deletion's claim-to-registration window before doing any paid work.
      const current = await this.database.client.document.findFirst({
        where: {
          id: document.id,
          status: 'processing',
          processingRunId: document.processingRunId,
        },
        select: { id: true },
      });
      if (!current) throw interrupted();
      controller.signal.throwIfAborted();
      let bytes: Buffer;
      try {
        bytes = await abortable(
          this.store.readOriginal(document.storagePath),
          controller.signal,
        );
      } catch (error) {
        if (controller.signal.aborted) throw error;
        throw new ProcessingFailure(
          (error as NodeJS.ErrnoException).code === 'ENOENT'
            ? 'ORIGINAL_FILE_MISSING'
            : 'STORAGE_ERROR',
          'Original file could not be read.',
          true,
        );
      }
      const prepared = await this.extractor.prepare(
        bytes,
        document.mimeType,
        controller.signal,
      );
      const result = await abortable(
        this.embeddings.embed(prepared.chunks, controller.signal, deadline),
        controller.signal,
      );
      controller.signal.throwIfAborted();
      const published = await this.persistence.publish(
        document,
        prepared,
        result.vectors,
        controller.signal,
      );
      this.logger.log({
        operation: 'ingestion',
        documentId: document.id,
        status: published ? 'ready' : 'discarded',
        inputTokens: result.inputTokens,
        latencyMs: Date.now() - started,
      });
    } catch (error) {
      const failure = controller.signal.aborted
        ? controller.signal.reason instanceof ProcessingFailure
          ? controller.signal.reason
          : interrupted()
        : error instanceof ProcessingFailure
          ? error
          : new ProcessingFailure(
              'STORAGE_ERROR',
              'Processing could not be saved. Reprocess to retry.',
              true,
            );
      await this.persistence.fail(document, failure);
      this.logger.warn({
        operation: 'ingestion',
        documentId: document.id,
        status: 'failed',
        code: failure.code,
        latencyMs: Date.now() - started,
      });
    } finally {
      clearTimeout(timeout);
      unregister();
      this.controller = undefined;
    }
  }
  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    this.controller?.abort(interrupted());
    await this.running;
  }
}
