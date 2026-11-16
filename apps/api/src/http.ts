import { randomUUID } from 'node:crypto';
import { Catch, HttpException, Injectable } from '@nestjs/common';
import type {
  ArgumentsHost,
  CallHandler,
  ExceptionFilter,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { map } from 'rxjs';

function requestId(response: Response): string {
  return String(response.getHeader('X-Request-Id'));
}

@Injectable()
class EnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const response = context.switchToHttp().getResponse<Response>();
    return next
      .handle()
      .pipe(map((data: unknown) => ({ data, requestId: requestId(response) })));
  }
}

@Catch()
class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const errors: Record<number, { code: string; message: string }> = {
      400: { code: 'VALIDATION_ERROR', message: 'Invalid request.' },
      403: { code: 'FORBIDDEN', message: 'Request is not allowed.' },
      404: { code: 'NOT_FOUND', message: 'Route not found.' },
      413: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body exceeds the allowed size.',
      },
    };
    response.status(status).json({
      error: errors[status] ?? {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
      },
      requestId: requestId(response),
    });
  }
}

export function configureHttp(app: NestExpressApplication): void {
  app.setGlobalPrefix('api');
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('X-Request-Id', randomUUID());
    next();
  });
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.useGlobalFilters(new SafeExceptionFilter());
  app.useBodyParser('json', { limit: '16kb' });
}
