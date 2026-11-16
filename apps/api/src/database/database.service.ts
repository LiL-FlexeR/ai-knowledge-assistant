import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { z } from 'zod';
import { API_CONFIG } from '../config/config.module';
import type { Environment } from '../config/environment';
import { createDatabaseClient } from './client';
import type { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  readonly client: PrismaClient | undefined;

  constructor(@Inject(API_CONFIG) private readonly config: Environment) {
    // Lazy connection keeps liveness available during database outages.
    this.client = config.DATABASE_URL
      ? createDatabaseClient(config.DATABASE_URL)
      : undefined;
  }

  async inspect(): Promise<{ database: boolean; embeddingProfile: boolean }> {
    if (!this.client) return { database: false, embeddingProfile: false };
    const schema = z.array(
      z.object({ extension: z.boolean(), vectorType: z.string().nullable() }),
    );
    const [metadata] = schema.parse(
      await this.client.$queryRaw`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname = 'vector' AND n.nspname = 'public'
      ) AS extension,
      (SELECT format_type(a.atttypid, a.atttypmod)
       FROM pg_attribute a
       WHERE a.attrelid = to_regclass('public.document_chunks')
         AND a.attname = 'embedding' AND a.attnotnull AND NOT a.attisdropped
      ) AS "vectorType"
    `,
    );
    const [profile] = z.array(z.object({ compatible: z.boolean() })).parse(
      await this.client.$queryRaw`
        SELECT NOT EXISTS (
          SELECT 1 FROM documents WHERE status = 'ready' AND (
            embedding_profile_id IS DISTINCT FROM ${this.config.EMBEDDING_PROFILE_ID}
            OR embedding_model IS DISTINCT FROM ${this.config.OPENAI_EMBEDDING_MODEL}
            OR embedding_dimensions IS DISTINCT FROM ${this.config.EMBEDDING_DIMENSIONS}::integer
            OR pipeline_version IS DISTINCT FROM ${this.config.PIPELINE_VERSION}
          )
        ) AS compatible
      `,
    );
    return {
      database: metadata?.extension === true,
      embeddingProfile:
        metadata?.vectorType ===
          `vector(${this.config.EMBEDDING_DIMENSIONS})` &&
        profile?.compatible === true,
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client?.$disconnect();
  }
}
