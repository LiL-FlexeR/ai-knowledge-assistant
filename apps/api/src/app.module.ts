import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { DocumentsModule } from './modules/documents/documents.module';

@Module({ imports: [ConfigModule, HealthModule, DocumentsModule] })
export class AppModule {}
