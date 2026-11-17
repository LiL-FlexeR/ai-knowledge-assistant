import { z } from 'zod';

export const healthSchema = z.strictObject({ status: z.literal('ok') });
export type Health = z.infer<typeof healthSchema>;

export const successEnvelopeSchema = <T extends z.ZodType>(data: T) =>
  z.strictObject({ data, requestId: z.uuid() });

export const healthResponseSchema = successEnvelopeSchema(healthSchema);

export const readinessSchema = z.strictObject({
  status: z.literal('ready'),
  checks: z.strictObject({
    database: z.literal('ok'),
    storage: z.literal('ok'),
    embeddingProfile: z.literal('ok'),
    aiConfiguration: z.enum(['ok', 'disabled']),
  }),
});
export type Readiness = z.infer<typeof readinessSchema>;
export const readinessResponseSchema = successEnvelopeSchema(readinessSchema);

export const errorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z
      .array(z.strictObject({ path: z.string(), message: z.string() }))
      .optional(),
  }),
  requestId: z.uuid(),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const documentStatusSchema = z.enum([
  'pending',
  'processing',
  'ready',
  'failed',
  'deleting',
]);
export const processingErrorSchema = z.strictObject({
  code: z.string().min(1).max(100),
  message: z.string().min(1).max(500),
  retryable: z.boolean(),
});
export const documentSchema = z.strictObject({
  id: z.uuid(),
  filename: z.string().min(1).max(255),
  mimeType: z.enum(['application/pdf', 'text/plain', 'text/markdown']),
  size: z.number().int().positive(),
  status: documentStatusSchema,
  chunkCount: z.number().int().nonnegative(),
  processingError: processingErrorSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  processedAt: z.iso.datetime().nullable(),
});
export type DocumentDTO = z.infer<typeof documentSchema>;
export const documentResponseSchema = successEnvelopeSchema(documentSchema);
export const documentListQuerySchema = z.strictObject({
  limit: z
    .string()
    .regex(/^[1-9]\d{0,2}$/)
    .transform(Number)
    .pipe(z.number().max(100))
    .default(20),
  cursor: z.string().min(1).max(1024).optional(),
  status: documentStatusSchema.optional(),
});
export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;
export const documentListSchema = z.strictObject({
  items: z.array(documentSchema),
  pagination: z.strictObject({
    limit: z.number().int().min(1).max(100),
    nextCursor: z.string().nullable(),
  }),
});
export const documentListResponseSchema =
  successEnvelopeSchema(documentListSchema);
export type DocumentList = z.infer<typeof documentListSchema>;
