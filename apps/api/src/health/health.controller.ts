import { Controller, Get } from '@nestjs/common';
import type { Health } from '@aka/shared';

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): Health {
    return { status: 'ok' };
  }
}
