import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { sourceLocationSchema } from '@aka/shared';
import { ApiError } from '../../api-error';
import { API_CONFIG } from '../../config/config.module';
import type { Environment } from '../../config/environment';
import { DatabaseService } from '../../database/database.service';
import { serializeVector } from '../../database/vector-sql';

export const vectorRowSchema = z.strictObject({
  chunkId: z.uuid(),
  processingRunId: z.uuid(),
  documentId: z.uuid(),
  chunkIndex: z.number().int().nonnegative(),
  filename: z.string().min(1).max(255),
  content: z.string().min(1),
  location: sourceLocationSchema,
  distance: z.number().finite().min(0).max(2),
});
export type VectorRow = z.infer<typeof vectorRowSchema>;
const unavailable = () =>
  new ApiError(503, 'SERVICE_UNAVAILABLE', 'Search storage is unavailable.');

@Injectable()
export class VectorReader {
  constructor(
    private readonly database: DatabaseService,
    @Inject(API_CONFIG) private readonly config: Environment,
  ) {}
  private get client() {
    if (!this.database.client) throw unavailable();
    return this.database.client;
  }
  async hasEligibleDocuments(documentIds?: string[]): Promise<boolean> {
    try {
      if (documentIds) {
        const found = await this.client.document.count({
          where: { id: { in: documentIds } },
        });
        if (found !== documentIds.length)
          throw new ApiError(
            404,
            'DOCUMENT_NOT_FOUND',
            'Document filter contains an unknown document.',
          );
      }
      const inspection = await this.database.inspect();
      if (!inspection.database) throw unavailable();
      if (!inspection.embeddingProfile)
        throw new ApiError(
          503,
          'EMBEDDING_PROFILE_MISMATCH',
          'Stored embeddings do not match the active profile.',
        );
      return (
        (await this.client.document.count({
          where: {
            status: 'ready',
            embeddingProfileId: this.config.EMBEDDING_PROFILE_ID,
            embeddingModel: this.config.OPENAI_EMBEDDING_MODEL,
            embeddingDimensions: this.config.EMBEDDING_DIMENSIONS,
            pipelineVersion: this.config.PIPELINE_VERSION,
            ...(documentIds ? { id: { in: documentIds } } : {}),
          },
        })) > 0
      );
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw unavailable();
    }
  }
  async assertUnchanged(sources: readonly VectorRow[]): Promise<void> {
    try {
      const rows = await this.client.document.findMany({
        where: {
          id: { in: [...new Set(sources.map((source) => source.documentId))] },
          status: 'ready',
          embeddingProfileId: this.config.EMBEDDING_PROFILE_ID,
          embeddingModel: this.config.OPENAI_EMBEDDING_MODEL,
          embeddingDimensions: this.config.EMBEDDING_DIMENSIONS,
          pipelineVersion: this.config.PIPELINE_VERSION,
        },
        select: { id: true, processingRunId: true },
      });
      if (
        sources.some(
          (source) =>
            !rows.some(
              (row) =>
                row.id === source.documentId &&
                row.processingRunId === source.processingRunId,
            ),
        )
      )
        throw new ApiError(
          409,
          'DOCUMENT_CHANGED',
          'Cited documents changed. Please retry.',
        );
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw unavailable();
    }
  }
  async nearest(
    vector: readonly number[],
    topK: number,
    documentIds?: string[],
  ): Promise<VectorRow[]> {
    const boundVector = serializeVector(vector);
    try {
      return z
        .array(vectorRowSchema)
        .max(topK)
        .parse(
          await this.client.$queryRaw`
        SELECT c.id AS "chunkId", c.document_id AS "documentId",
          c.chunk_index AS "chunkIndex", c.processing_run_id AS "processingRunId", d.filename, c.content,
          c.source_location AS location,
          c.embedding <=> ${boundVector}::vector(1536) AS distance
        FROM document_chunks c JOIN documents d ON d.id = c.document_id
        WHERE d.status = 'ready'
          AND d.embedding_profile_id = ${this.config.EMBEDDING_PROFILE_ID}
          AND d.embedding_model = ${this.config.OPENAI_EMBEDDING_MODEL}
          AND d.embedding_dimensions = ${this.config.EMBEDDING_DIMENSIONS}::integer
          AND d.pipeline_version = ${this.config.PIPELINE_VERSION}
          AND c.processing_run_id = d.processing_run_id
          AND (${documentIds ?? null}::uuid[] IS NULL OR d.id = ANY(${documentIds ?? null}::uuid[]))
        ORDER BY distance, c.id
        LIMIT ${topK}::integer
      `,
        );
    } catch {
      throw unavailable();
    }
  }
}
