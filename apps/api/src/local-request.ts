import type { Request } from 'express';
import { ApiError } from './api-error';

export function assertLocalRequest(request: Request, origin: string): void {
  let hostname: string;
  try {
    const host = new URL(`http://${request.headers.host ?? ''}`);
    if (host.username || host.password || host.pathname !== '/')
      throw new Error();
    hostname = host.hostname;
  } catch {
    throw new ApiError(403, 'FORBIDDEN', 'Request is not allowed.');
  }
  if (
    !['localhost', '127.0.0.1', '[::1]', 'api'].includes(hostname) ||
    request.headers['x-forwarded-host'] ||
    (['POST', 'DELETE'].includes(request.method) &&
      request.headers.origin &&
      request.headers.origin !== origin)
  )
    throw new ApiError(403, 'FORBIDDEN', 'Request is not allowed.');
}
