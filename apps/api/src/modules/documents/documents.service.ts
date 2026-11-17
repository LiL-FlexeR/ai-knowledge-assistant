import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { documentSchema } from '@aka/shared';
import type { DocumentDTO, DocumentList, DocumentListQuery } from '@aka/shared';
import { ApiError, invalidRequest, storageError } from '../../api-error';
import { API_CONFIG } from '../../config/config.module';
import type { Environment } from '../../config/environment';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import type { Document } from '../../generated/prisma/client';
import { DocumentCursors } from './cursor';
import { LocalDocumentStore } from './local-document-store';
import { UploadReceiver } from './upload-receiver';

export function toDocumentDTO(row: Document): DocumentDTO {
  return documentSchema.parse({
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    size: row.size,
    status: row.status,
    chunkCount: row.chunkCount,
    processingError: row.processingError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    processedAt: row.processedAt?.toISOString() ?? null,
  });
}

export function assertCapacity(
  count: number,
  bytes: number,
  pending: number,
  size: number,
  config: Environment,
): void {
  if (
    count >= config.MAX_DOCUMENTS ||
    bytes + size > config.MAX_STORED_BYTES ||
    pending >= config.MAX_PENDING_DOCUMENTS
  ) {
    throw new ApiError(
      409,
      'CAPACITY_EXCEEDED',
      'Document capacity is full. Delete a document before uploading.',
    );
  }
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private readonly cursors = new DocumentCursors();
  constructor(
    private readonly database: DatabaseService,
    private readonly store: LocalDocumentStore,
    private readonly receiver: UploadReceiver,
    @Inject(API_CONFIG) private readonly config: Environment,
  ) {}
  private get db() {
    if (!this.database.client)
      throw new ApiError(
        503,
        'SERVICE_UNAVAILABLE',
        'Database is unavailable.',
      );
    return this.database.client;
  }

  async upload(request: Request, signal: AbortSignal): Promise<DocumentDTO> {
    const db = this.db;
    const upload = await this.receiver.receive(request, signal);
    const storagePath = `${upload.id}/original.${upload.extension}`;
    let committed = false;
    try {
      if (signal.aborted) throw invalidRequest();
      try {
        await this.store.promote(upload.stage, storagePath);
      } catch {
        throw storageError();
      }
      const row = await db.$transaction(async (tx) => {
        // One shared lock for every admission path; no filesystem/provider work here.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(71002)`;
        const totals = await tx.document.aggregate({
          _count: true,
          _sum: { size: true },
        });
        const pending = await tx.document.count({
          where: { status: { in: ['pending', 'processing'] } },
        });
        assertCapacity(
          totals._count,
          totals._sum.size ?? 0,
          pending,
          upload.size,
          this.config,
        );
        if (signal.aborted) throw invalidRequest();
        return tx.document.create({
          data: {
            id: upload.id,
            filename: upload.filename,
            mimeType: upload.mimeType,
            size: upload.size,
            storagePath,
            processingRunId: randomUUID(),
          },
        });
      });
      committed = true;
      if (signal.aborted) {
        await this.delete(upload.id);
        throw invalidRequest();
      }
      this.logger.log({
        operation: 'document.upload',
        documentId: row.id,
        status: 'pending',
        requestId: request.res?.getHeader('X-Request-Id'),
      });
      return toDocumentDTO(row);
    } catch (error) {
      if (!committed) {
        // A crash or failed compensation is recovered by the aged orphan sweep.
        const cleanup = await Promise.allSettled([
          this.store.removeStage(upload.stage),
          this.store.removeOriginal(storagePath),
        ]);
        if (cleanup.some((result) => result.status === 'rejected'))
          throw storageError();
      }
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'INTERNAL_ERROR', 'Document could not be saved.');
    }
  }

  async list(query: DocumentListQuery): Promise<DocumentList> {
    const cursor = query.cursor
      ? this.cursors.decode(query.cursor, query.status)
      : undefined;
    const rows = await this.db.document.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items: items.map(toDocumentDTO),
      pagination: {
        limit: query.limit,
        nextCursor:
          rows.length > query.limit && last
            ? this.cursors.encode(last.createdAt, last.id, query.status)
            : null,
      },
    };
  }

  async detail(id: string): Promise<DocumentDTO> {
    const row = await this.db.document.findUnique({ where: { id } });
    if (!row)
      throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
    return toDocumentDTO(row);
  }

  async delete(id: string): Promise<void> {
    const db = this.db;
    try {
      const row = await db.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM documents WHERE id = ${id}::uuid FOR UPDATE`;
        if (locked.length === 0) return null;
        const current = await tx.document.findUniqueOrThrow({ where: { id } });
        if (current.status === 'deleting') return current;
        await tx.documentChunk.deleteMany({ where: { documentId: id } });
        return tx.document.update({
          where: { id },
          data: {
            status: 'deleting',
            processingRunId: randomUUID(),
            chunkCount: 0,
            extractedContent: null,
            sourceMap: Prisma.DbNull,
            processingError: Prisma.DbNull,
            embeddingProfileId: null,
            embeddingModel: null,
            embeddingDimensions: null,
            pipelineVersion: null,
            processingStartedAt: null,
            processedAt: null,
          },
        });
      });
      if (!row) return;
      this.logger.log({
        operation: 'document.delete',
        documentId: id,
        status: 'deleting',
      });
      await this.store.removeOriginal(row.storagePath);
      await db.document.deleteMany({ where: { id, status: 'deleting' } });
      this.logger.log({
        operation: 'document.delete',
        documentId: id,
        status: 'deleted',
      });
    } catch {
      await db.document
        .updateMany({
          where: { id, status: 'deleting' },
          data: {
            processingError: {
              code: 'DELETE_FAILED',
              message: 'Document cleanup failed. Retry deletion.',
              retryable: true,
            },
          },
        })
        .catch(() => undefined);
      throw new ApiError(
        500,
        'DELETE_FAILED',
        'Document cleanup failed. Retry deletion.',
      );
    }
  }
}
