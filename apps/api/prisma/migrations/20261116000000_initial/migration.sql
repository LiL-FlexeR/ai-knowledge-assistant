-- Reviewed S01 base schema. Keep extension creation before the vector column.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

CREATE TYPE "document_status" AS ENUM ('pending', 'processing', 'ready', 'failed', 'deleting');

CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "filename" VARCHAR(255) NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "status" "document_status" NOT NULL DEFAULT 'pending',
    "storage_path" TEXT NOT NULL,
    "extracted_content" TEXT,
    "source_map" JSONB,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "embedding_profile_id" TEXT,
    "embedding_model" TEXT,
    "embedding_dimensions" INTEGER,
    "pipeline_version" TEXT,
    "processing_run_id" UUID NOT NULL,
    "processing_started_at" TIMESTAMPTZ(3),
    "processed_at" TIMESTAMPTZ(3),
    "processing_error" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "documents_filename_check" CHECK (length(btrim(filename)) > 0 AND filename !~ '[/\\]'),
    CONSTRAINT "documents_mime_type_check" CHECK (mime_type IN ('application/pdf', 'text/plain', 'text/markdown')),
    CONSTRAINT "documents_size_check" CHECK (size > 0),
    CONSTRAINT "documents_chunk_count_check" CHECK (chunk_count >= 0),
    CONSTRAINT "documents_dimensions_check" CHECK (embedding_dimensions IS NULL OR embedding_dimensions > 0),
    CONSTRAINT "documents_storage_path_check" CHECK (length(storage_path) > 0)
);

CREATE TABLE "document_chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "processing_run_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "token_count" INTEGER NOT NULL,
    "source_location" JSONB NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_chunks_content_check" CHECK (length(btrim(content)) > 0),
    CONSTRAINT "document_chunks_index_check" CHECK (chunk_index >= 0),
    CONSTRAINT "document_chunks_tokens_check" CHECK (token_count > 0),
    CONSTRAINT "document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "documents_storage_path_key" ON "documents"("storage_path");
CREATE INDEX "documents_created_at_id_idx" ON "documents"("created_at" DESC, "id" DESC);
CREATE INDEX "documents_status_created_at_id_idx" ON "documents"("status", "created_at", "id");
CREATE UNIQUE INDEX "document_chunks_document_id_chunk_index_key" ON "document_chunks"("document_id", "chunk_index");

-- The bootstrap creates this non-owner role. Never grant it schema/extension or
-- migration-ledger privileges. New tables require explicit reviewed grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON "documents", "document_chunks" TO aka_runtime;
