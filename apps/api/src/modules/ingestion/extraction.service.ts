import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { Inject, Injectable } from '@nestjs/common';
import { API_CONFIG } from '../../config/config.module';
import type { Environment } from '../../config/environment';
import type { PreparedDocument } from './source-processing';
import { interrupted, ProcessingFailure } from '../../processing-error';

@Injectable()
export class ExtractionService {
  constructor(@Inject(API_CONFIG) private readonly config: Environment) {}
  async prepare(
    bytes: Buffer,
    mime: string,
    signal: AbortSignal,
  ): Promise<PreparedDocument> {
    signal.throwIfAborted();
    const emitted = join(__dirname, 'preparation.worker.js');
    // ts-jest runs services from src; the worker always runs the production build.
    const entry = existsSync(emitted)
      ? emitted
      : join(
          __dirname,
          '../../../dist/modules/ingestion/preparation.worker.js',
        );
    const {
      MAX_PDF_PAGES,
      MAX_EXTRACTED_CHARS,
      MAX_DOCUMENT_TOKENS,
      MAX_CHUNKS,
      CHUNK_TOKENS,
      CHUNK_OVERLAP_TOKENS,
    } = this.config;
    const worker = new Worker(entry, {
      workerData: {
        bytes: new Uint8Array(bytes),
        mime,
        config: {
          MAX_PDF_PAGES,
          MAX_EXTRACTED_CHARS,
          MAX_DOCUMENT_TOKENS,
          MAX_CHUNKS,
          CHUNK_TOKENS,
          CHUNK_OVERLAP_TOKENS,
        },
      },
      resourceLimits: {
        maxOldGenerationSizeMb: this.config.EXTRACTION_MAX_MEMORY_MB,
      },
      stdout: true,
      stderr: true,
      env: {},
    });
    // Drop parser diagnostics, which may contain untrusted content. Drain pipes.
    worker.stdout?.resume();
    worker.stderr?.resume();
    let timer: NodeJS.Timeout | undefined;
    let abort: () => void = () => undefined;
    try {
      return await new Promise<PreparedDocument>((resolve, reject) => {
        abort = () =>
          reject(
            signal.reason instanceof ProcessingFailure
              ? signal.reason
              : interrupted(),
          );
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) {
          abort();
          return;
        }
        timer = setTimeout(
          () =>
            reject(
              new ProcessingFailure(
                'EXTRACTION_LIMIT_EXCEEDED',
                'Extraction exceeded its time limit.',
              ),
            ),
          this.config.EXTRACTION_TIMEOUT_MS,
        );
        worker.once('error', () =>
          reject(
            new ProcessingFailure(
              'EXTRACTION_LIMIT_EXCEEDED',
              'Extraction exceeded worker limits or could not run.',
            ),
          ),
        );
        worker.once('exit', () =>
          reject(
            new ProcessingFailure(
              'INVALID_DOCUMENT',
              'Extraction worker stopped without a result.',
            ),
          ),
        );
        worker.once(
          'message',
          (message: {
            result?: PreparedDocument;
            error?: { code: string; message: string; retryable: boolean };
          }) => {
            if (message.error)
              reject(
                new ProcessingFailure(
                  message.error.code,
                  message.error.message,
                  message.error.retryable,
                ),
              );
            else if (message.result) resolve(message.result);
            else
              reject(
                new ProcessingFailure(
                  'INVALID_DOCUMENT',
                  'Extraction produced no result.',
                ),
              );
          },
        );
      });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      await worker.terminate();
    }
  }
}
