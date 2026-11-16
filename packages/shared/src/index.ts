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
