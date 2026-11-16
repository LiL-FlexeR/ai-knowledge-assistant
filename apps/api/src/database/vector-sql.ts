import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '../generated/prisma/client';

export const VECTOR_DIMENSIONS = 1536;

export function serializeVector(vector: readonly number[]): string {
  if (
    vector.length !== VECTOR_DIMENSIONS ||
    !vector.every(Number.isFinite) ||
    !vector.some((value) => value !== 0)
  ) {
    throw new Error('Expected a finite, nonzero 1536-dimensional vector.');
  }
  // PostgreSQL vector stores float32. Reject overflow/underflow of its norm too.
  const values = vector.map(Math.fround);
  if (!values.every(Number.isFinite) || !values.some((value) => value !== 0)) {
    throw new Error('Vector is outside the supported float32 range.');
  }
  return `[${values.join(',')}]`;
}

type SqlClient = Pick<Prisma.TransactionClient, '$executeRaw' | '$queryRaw'>;

// Infrastructure primitives only. Ingestion/publication and ready/profile-filtered
// retrieval belong to S03/S04, with their own application validation and fencing.
export async function insertVectorChunk(
  client: SqlClient,
  chunk: {
    documentId: string;
    processingRunId: string;
    content: string;
    chunkIndex: number;
    tokenCount: number;
    sourceLocation: Prisma.InputJsonValue;
    embedding: readonly number[];
  },
): Promise<string> {
  const vector = serializeVector(chunk.embedding);
  const id = randomUUID();
  await client.$executeRaw`
    INSERT INTO document_chunks
      (id, document_id, processing_run_id, content, chunk_index, token_count, source_location, embedding)
    VALUES (${id}::uuid, ${chunk.documentId}::uuid, ${chunk.processingRunId}::uuid,
      ${chunk.content}, ${chunk.chunkIndex}::integer, ${chunk.tokenCount}::integer,
      ${JSON.stringify(chunk.sourceLocation)}::jsonb, ${vector}::vector(1536))
  `;
  return id;
}

export async function readVectorDistances(
  client: SqlClient,
  documentId: string,
  vector: readonly number[],
): Promise<
  { id: string; content: string; chunkIndex: number; distance: number }[]
> {
  const boundVector = serializeVector(vector);
  return z
    .array(
      z.object({
        id: z.uuid(),
        content: z.string(),
        chunkIndex: z.number().int().nonnegative(),
        distance: z.number().finite(),
      }),
    )
    .parse(
      await client.$queryRaw`
      SELECT id, content, chunk_index AS "chunkIndex",
             embedding <=> ${boundVector}::vector(1536) AS distance
      FROM document_chunks WHERE document_id = ${documentId}::uuid
      ORDER BY distance, id
    `,
    );
}
