import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { ReadinessService } from './readiness.service';
import { StorageProbe } from './storage-probe';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [HealthController],
  providers: [ReadinessService, StorageProbe],
})
export class HealthModule {}
