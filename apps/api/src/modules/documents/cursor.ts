import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { documentStatusSchema } from '@aka/shared';
import { invalidRequest } from '../../api-error';

const payloadSchema = z.strictObject({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
  status: documentStatusSchema.nullable(),
});
// Local single-process cursors deliberately expire at API restart.
export class DocumentCursors {
  private readonly key = randomBytes(32);
  encode(createdAt: Date, id: string, status?: string): string {
    const body = Buffer.from(
      JSON.stringify({
        createdAt: createdAt.toISOString(),
        id,
        status: status ?? null,
      }),
    ).toString('base64url');
    return `${body}.${this.sign(body)}`;
  }
  decode(cursor: string, status?: string) {
    try {
      const [body, signature, extra] = cursor.split('.');
      if (
        !body ||
        !signature ||
        extra ||
        !/^[\w-]+$/.test(body) ||
        !/^[\w-]{43}$/.test(signature)
      )
        throw invalidRequest();
      if (
        !timingSafeEqual(Buffer.from(signature), Buffer.from(this.sign(body)))
      )
        throw invalidRequest();
      const payload = payloadSchema.parse(
        JSON.parse(Buffer.from(body, 'base64url').toString('utf8')),
      );
      if (payload.status !== (status ?? null)) throw invalidRequest();
      return { createdAt: new Date(payload.createdAt), id: payload.id };
    } catch {
      throw invalidRequest();
    }
  }
  private sign(body: string) {
    return createHmac('sha256', this.key).update(body).digest('base64url');
  }
}
