import { Inject, Injectable } from '@nestjs/common';
import { API_CONFIG } from '../../config/config.module';
import type { Environment } from '../../config/environment';
import { DatabaseService } from '../../database/database.service';
import { insertVectorChunk, serializeVector } from '../../database/vector-sql';
import { Prisma } from '../../generated/prisma/client';
import type { Document } from '../../generated/prisma/client';
import { interrupted, ProcessingFailure } from '../../processing-error';
import { validatePrepared } from './source-processing';
import type { PreparedDocument } from './source-processing';

@Injectable()
export class IngestionPersistence {
  constructor(
    private readonly database: DatabaseService,
    @Inject(API_CONFIG) private readonly config: Environment,
  ) {}
  async recover(): Promise<void> {
    const db = this.database.client;
    if (!db) return;
    // No automatic paid retry after restart. Clear any interrupted generation atomically.
    await db.$transaction(async (tx) => {
      const rows = await tx.document.findMany({
        where: { status: 'processing' },
        select: { id: true },
      });
      await tx.documentChunk.deleteMany({
        where: { documentId: { in: rows.map((row) => row.id) } },
      });
      await tx.document.updateMany({
        where: { status: 'processing' },
        data: {
          status: 'failed',
          chunkCount: 0,
          extractedContent: null,
          sourceMap: Prisma.DbNull,
          embeddingProfileId: null,
          embeddingModel: null,
          embeddingDimensions: null,
          pipelineVersion: null,
          processedAt: null,
          processingError: interrupted().toJSON(),
        },
      });
    });
  }
  async claim(): Promise<Document | null> {
    const db = this.database.client;
    if (!db) return null;
    const next = await db.document.findFirst({
      where: { status: 'pending' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (!next) return null;
    const result = await db.document.updateMany({
      where: {
        id: next.id,
        processingRunId: next.processingRunId,
        status: 'pending',
      },
      data: {
        status: 'processing',
        processingStartedAt: new Date(),
        processingError: Prisma.DbNull,
      },
    });
    return result.count ? { ...next, status: 'processing' } : null;
  }
  async publish(
    document: Document,
    prepared: PreparedDocument,
    vectors: number[][],
    signal: AbortSignal,
  ): Promise<boolean> {
    validatePrepared(prepared, this.config);
    if (vectors.length !== prepared.chunks.length)
      throw new ProcessingFailure(
        'AI_OUTPUT_INVALID',
        'Embedding response is incomplete.',
      );
    try {
      vectors.forEach(serializeVector);
    } catch {
      throw new ProcessingFailure(
        'AI_OUTPUT_INVALID',
        'Embedding response is invalid.',
      );
    }
    const db = this.database.client!;
    return db.$transaction(
      async (tx) => {
        signal.throwIfAborted();
        const locked = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM documents WHERE id = ${document.id}::uuid FOR UPDATE`;
        if (!locked.length) return false;
        const current = await tx.document.findUniqueOrThrow({
          where: { id: document.id },
        });
        if (
          current.status !== 'processing' ||
          current.processingRunId !== document.processingRunId
        )
          return false;
        for (const [index, chunk] of prepared.chunks.entries()) {
          signal.throwIfAborted();
          await insertVectorChunk(tx, {
            documentId: document.id,
            processingRunId: document.processingRunId,
            ...chunk,
            embedding: vectors[index]!,
          });
        }
        signal.throwIfAborted();
        await tx.document.update({
          where: { id: document.id },
          data: {
            status: 'ready',
            chunkCount: prepared.chunks.length,
            extractedContent: prepared.content,
            sourceMap: prepared.sourceMap as unknown as Prisma.InputJsonValue,
            embeddingProfileId: this.config.EMBEDDING_PROFILE_ID,
            embeddingModel: this.config.OPENAI_EMBEDDING_MODEL,
            embeddingDimensions: this.config.EMBEDDING_DIMENSIONS,
            pipelineVersion: this.config.PIPELINE_VERSION,
            processedAt: new Date(),
            processingError: Prisma.DbNull,
          },
        });
        signal.throwIfAborted();
        return true;
      },
      { timeout: 10000 },
    );
  }
  async fail(document: Document, error: ProcessingFailure): Promise<void> {
    await this.database.client?.document.updateMany({
      where: {
        id: document.id,
        status: 'processing',
        processingRunId: document.processingRunId,
      },
      data: {
        status: 'failed',
        processingError: error.toJSON(),
      },
    });
  }
}
