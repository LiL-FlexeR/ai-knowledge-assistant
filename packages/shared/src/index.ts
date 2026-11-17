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
export const reprocessResponseSchema = documentResponseSchema;
const span = {
  unitIndex: z.number().int().nonnegative(),
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().nonnegative(),
};
const lines = {
  sectionOrdinal: z.number().int().positive(),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
};
export const sourceLocationSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('pdf'),
    ...span,
    page: z.number().int().positive(),
  }),
  z.strictObject({ kind: z.literal('text'), ...span, ...lines }),
  z.strictObject({
    kind: z.literal('markdown'),
    ...span,
    ...lines,
    headingPath: z.array(z.string()),
  }),
]);
export type SourceLocation = z.infer<typeof sourceLocationSchema>;
export const sourceSchema = z.strictObject({
  documentId: z.uuid(),
  filename: z.string().min(1).max(255),
  location: sourceLocationSchema,
  excerpt: z.string().min(1).max(1000),
});
export type SourceDTO = z.infer<typeof sourceSchema>;
export const searchRequestSchema = z.strictObject({
  query: z.string().trim().min(1).max(2000),
  topK: z.number().int().min(1).max(10).optional(),
  documentIds: z
    .array(z.uuid().toLowerCase())
    .min(1)
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length)
    .optional(),
});
export type SearchRequest = z.infer<typeof searchRequestSchema>;
export const searchHitSchema = z.strictObject({
  chunkId: z.uuid(),
  chunkIndex: z.number().int().nonnegative(),
  similarity: z.number().min(-1).max(1),
  source: sourceSchema,
});
export type SearchHit = z.infer<typeof searchHitSchema>;
export const searchSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('results'),
    reason: z.null(),
    results: z.array(searchHitSchema).min(1).max(10),
  }),
  z.strictObject({
    status: z.literal('insufficient_context'),
    reason: z.enum(['NO_READY_DOCUMENTS', 'NO_RELEVANT_CONTEXT']),
    results: z.array(searchHitSchema).max(0),
  }),
]);
export type SearchResponse = z.infer<typeof searchSchema>;
export const searchResponseSchema = successEnvelopeSchema(searchSchema);
export const askRequestSchema = searchRequestSchema
  .omit({ query: true })
  .extend({
    question: z.string().trim().min(1).max(2000),
  });
export type AskRequest = z.infer<typeof askRequestSchema>;
export const sourceIdSchema = z.string().regex(/^S(?:[1-9]|10)$/);
export const answerStatementSchema = z.strictObject({
  text: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine(
      (text) => !/[\uD800-\uDFFF]/u.test(text) && !/\[S\d+\]/u.test(text),
    ),
  sourceIds: z
    .array(sourceIdSchema)
    .min(1)
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length),
});
export type AnswerStatement = z.infer<typeof answerStatementSchema>;
export const citationSchema = z.strictObject({
  sourceId: sourceIdSchema,
  chunkId: z.uuid(),
  source: sourceSchema,
});
export const answerLimitationSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((text) => !/[\uD800-\uDFFF]/u.test(text) && !/\[S\d+\]/u.test(text));
export const askUsageSchema = z.strictObject({
  embeddingInputTokens: z.number().int().nonnegative().nullable(),
  generationInputTokens: z.number().int().nonnegative().nullable(),
  generationOutputTokens: z.number().int().nonnegative().nullable(),
});
export function formatAnswer(
  statements: AnswerStatement[],
  limitation: string | null,
): string {
  return [
    ...statements.map(
      ({ text, sourceIds }) =>
        `${text} ${sourceIds.map((id) => `[${id}]`).join(' ')}`,
    ),
    ...(limitation ? [limitation] : []),
  ].join('\n\n');
}
export const askSchema = z
  .strictObject({
    status: z.enum(['answered', 'insufficient_context', 'refused']),
    answer: z.string().min(1),
    statements: z.array(answerStatementSchema).max(8),
    citations: z.array(citationSchema).max(10),
    reason: z
      .enum([
        'NO_READY_DOCUMENTS',
        'NO_RELEVANT_CONTEXT',
        'EVIDENCE_INSUFFICIENT',
        'PROVIDER_REFUSAL',
      ])
      .nullable(),
    limitation: answerLimitationSchema.nullable(),
    retrieval: z.strictObject({
      requestedTopK: z.number().int().min(1).max(10),
      matchedChunks: z.number().int().min(0).max(10),
      contextChunks: z.number().int().min(0).max(10),
    }),
    usage: askUsageSchema,
  })
  .superRefine((value, ctx) => {
    const fail = () =>
      ctx.addIssue({ code: 'custom', message: 'Invalid answer invariants.' });
    const ids = value.citations.map((citation) => citation.sourceId);
    const used = new Set(
      value.statements.flatMap((statement) => statement.sourceIds),
    );
    const { requestedTopK, matchedChunks, contextChunks } = value.retrieval;
    if (
      contextChunks > matchedChunks ||
      matchedChunks > requestedTopK ||
      ids.length > contextChunks ||
      new Set(ids).size !== ids.length ||
      new Set(value.citations.map((citation) => citation.chunkId)).size !==
        ids.length ||
      ids.some(
        (id, i) =>
          Number(id.slice(1)) > contextChunks ||
          (i > 0 && Number(ids[i - 1]!.slice(1)) >= Number(id.slice(1))),
      )
    )
      fail();
    if (value.status === 'answered') {
      if (
        !value.statements.length ||
        value.reason !== null ||
        used.size !== ids.length ||
        ids.some((id) => !used.has(id)) ||
        value.answer !== formatAnswer(value.statements, value.limitation)
      )
        fail();
    } else {
      if (
        value.statements.length ||
        ids.length ||
        !value.limitation ||
        value.answer !== value.limitation
      )
        fail();
      if (
        value.status === 'refused'
          ? value.reason !== 'PROVIDER_REFUSAL'
          : ![
              'NO_READY_DOCUMENTS',
              'NO_RELEVANT_CONTEXT',
              'EVIDENCE_INSUFFICIENT',
            ].includes(value.reason ?? '')
      )
        fail();
      if (
        (value.reason === 'NO_READY_DOCUMENTS' ||
          value.reason === 'NO_RELEVANT_CONTEXT') &&
        (matchedChunks !== 0 || contextChunks !== 0)
      )
        fail();
    }
  });
export type AskResponse = z.infer<typeof askSchema>;
export const askResponseSchema = successEnvelopeSchema(askSchema);
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
