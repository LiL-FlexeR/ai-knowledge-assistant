import { Controller, Get } from '@nestjs/common';
import type { Health, Readiness } from '@aka/shared';
import { ReadinessService } from './readiness.service';

@Controller('health')
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}

  @Get()
  getHealth(): Health {
    return { status: 'ok' };
  }

  @Get('ready')
  getReadiness(): Promise<Readiness> {
    return this.readiness.check();
  }
}
