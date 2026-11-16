// Compiled with DOM libraries to check the shared package's browser boundary.
import { healthResponseSchema, errorResponseSchema } from '@aka/shared';

export function parseHealthResponse(value: unknown) {
  return healthResponseSchema.parse(value);
}

export function parseErrorResponse(value: unknown) {
  return errorResponseSchema.parse(value);
}
