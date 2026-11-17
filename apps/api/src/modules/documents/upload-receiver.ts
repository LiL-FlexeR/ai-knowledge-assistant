import { randomUUID } from 'node:crypto';
import busboy from 'busboy';
import type { Request } from 'express';
import { Inject, Injectable } from '@nestjs/common';
import { API_CONFIG } from '../../config/config.module';
import type { Environment } from '../../config/environment';
import { ApiError, invalidRequest, storageError } from '../../api-error';
import { LocalDocumentStore } from './local-document-store';
import { sanitizeFilename, validateFormat } from './validation';

@Injectable()
export class UploadReceiver {
  private active = 0;
  constructor(
    private readonly store: LocalDocumentStore,
    @Inject(API_CONFIG) private readonly config: Environment,
  ) {}

  async receive(request: Request, disconnected: AbortSignal) {
    if (this.active >= this.config.MAX_UPLOAD_STREAMS)
      throw new ApiError(
        429,
        'RATE_LIMITED',
        'Upload capacity is busy. Try again shortly.',
        1,
      );
    if (!request.is('multipart/form-data')) throw invalidRequest();
    this.active++;
    const id = randomUUID();
    const stage = this.store.stageName(id);
    const abort = new AbortController();
    const cancel = () => abort.abort(invalidRequest());
    disconnected.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(cancel, this.config.UPLOAD_TIMEOUT_MS);
    let write: Promise<number> | undefined;
    try {
      if (disconnected.aborted) throw invalidRequest();
      const parser = busboy({
        headers: request.headers,
        defParamCharset: 'utf8',
        preservePath: true,
        limits: {
          fileSize: this.config.MAX_UPLOAD_BYTES + 1,
          files: 1,
          fields: 0,
          parts: 2,
          fieldSize: 0,
          headerPairs: 32,
        },
      });
      let filename: string | undefined;
      let claimed = '';
      let bodyBytes = 0;
      const bodyLimit = this.config.MAX_UPLOAD_BYTES + 65536;
      await new Promise<void>((resolve, reject) => {
        let ended = false;
        const fail = (error: unknown) => {
          if (ended) return;
          ended = true;
          request.unpipe(parser);
          abort.abort();
          parser.destroy();
          request.resume();
          reject(error);
        };
        const onAbort = () => fail(invalidRequest());
        const count = (chunk: Buffer) => {
          bodyBytes += chunk.length;
          if (bodyBytes > bodyLimit)
            fail(
              new ApiError(
                413,
                'PAYLOAD_TOO_LARGE',
                'Upload request exceeds the size limit.',
              ),
            );
        };
        const detach = () => {
          request.off('data', count);
          request.off('aborted', onAbort);
          abort.signal.removeEventListener('abort', onAbort);
        };
        parser.once('close', () => {
          detach();
          if (!ended) {
            ended = true;
            resolve();
          }
        });
        parser.once('error', () => fail(invalidRequest()));
        parser.on('filesLimit', () => fail(invalidRequest()));
        parser.on('fieldsLimit', () => fail(invalidRequest()));
        parser.on('partsLimit', () => fail(invalidRequest()));
        request.once('aborted', onAbort);
        abort.signal.addEventListener('abort', onAbort, { once: true });
        request.on('data', count);
        parser.on('file', (field, stream, info) => {
          // Root validation is asynchronous; handle a disconnect before pipeline attaches.
          stream.on('error', () => undefined);
          if (field !== 'file' || filename !== undefined || !info.filename) {
            stream.resume();
            fail(invalidRequest());
            return;
          }
          filename = sanitizeFilename(info.filename);
          claimed = info.mimeType;
          write = this.store.writeStage(stage, stream, abort.signal);
          void write.catch((error: unknown) =>
            fail(error instanceof ApiError ? error : storageError()),
          );
        });
        request.pipe(parser);
      });
      if (!write || !filename) throw invalidRequest();
      let size: number;
      try {
        size = await write;
      } catch (error) {
        throw error instanceof ApiError ? error : storageError();
      }
      let bytes: Buffer;
      try {
        bytes = await this.store.readStage(stage);
      } catch {
        throw storageError();
      }
      const format = validateFormat(filename, claimed, bytes);
      return { id, stage, filename, size, ...format };
    } catch (error) {
      abort.abort();
      if (write) await write.catch(() => undefined);
      await this.store.removeStage(stage).catch(() => undefined);
      if (error instanceof ApiError) throw error;
      throw invalidRequest();
    } finally {
      clearTimeout(timeout);
      disconnected.removeEventListener('abort', cancel);
      this.active--;
    }
  }
}
