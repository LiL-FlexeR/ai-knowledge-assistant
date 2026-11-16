import { z } from 'zod';

export const healthSchema = z.strictObject({ status: z.literal('ok') });
export type Health = z.infer<typeof healthSchema>;

export const successEnvelopeSchema = <T extends z.ZodType>(data: T) =>
  z.strictObject({ data, requestId: z.uuid() });

export const healthResponseSchema = successEnvelopeSchema(healthSchema);

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
