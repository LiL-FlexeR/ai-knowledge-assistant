import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { ApiError } from '../../api-error';
import { API_CONFIG } from '../../config/config.module';
import type { Environment } from '../../config/environment';

@Injectable()
export class DocumentAdmissionGuard implements CanActivate {
  private readonly windows = new Map<string, { count: number; ends: number }>();
  constructor(@Inject(API_CONFIG) private readonly config: Environment) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
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
      request.headers['x-forwarded-host']
    ) {
      throw new ApiError(403, 'FORBIDDEN', 'Request is not allowed.');
    }
    if (
      ['POST', 'DELETE'].includes(request.method) &&
      request.headers.origin &&
      request.headers.origin !== this.config.WEB_ORIGIN
    ) {
      throw new ApiError(403, 'FORBIDDEN', 'Request is not allowed.');
    }
    const now = Date.now();
    for (const [key, window] of this.windows)
      if (window.ends <= now) this.windows.delete(key);
    const upload = request.method === 'POST';
    const limit = upload
      ? this.config.UPLOAD_REQUESTS_PER_MINUTE
      : this.config.DOCUMENT_REQUESTS_PER_MINUTE;
    // Read the socket directly, never untrusted forwarded IP headers.
    const key = `${request.socket.remoteAddress ?? 'local'}:${upload ? 'upload' : 'documents'}`;
    const window = this.windows.get(key) ?? { count: 0, ends: now + 60000 };
    if (window.count >= limit)
      throw new ApiError(
        429,
        'RATE_LIMITED',
        'Too many requests. Try again shortly.',
        Math.max(1, Math.ceil((window.ends - now) / 1000)),
      );
    window.count++;
    this.windows.set(key, window);
    return true;
  }
}
