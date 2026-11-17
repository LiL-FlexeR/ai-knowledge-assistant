import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { ApiError } from '../../api-error';
import { API_CONFIG } from '../../config/config.module';
import type { Environment } from '../../config/environment';
import { assertLocalRequest } from '../../local-request';

@Injectable()
export class SearchAdmissionGuard implements CanActivate {
  private readonly windows = new Map<string, { count: number; ends: number }>();
  constructor(@Inject(API_CONFIG) private readonly config: Environment) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    assertLocalRequest(request, this.config.WEB_ORIGIN);
    const now = Date.now();
    for (const [key, window] of this.windows)
      if (window.ends <= now) this.windows.delete(key);
    const key = request.socket.remoteAddress ?? 'local';
    const window = this.windows.get(key) ?? { count: 0, ends: now + 60000 };
    if (window.count >= this.config.SEARCH_REQUESTS_PER_MINUTE)
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
