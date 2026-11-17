import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module';
import { DatabaseModule } from '../../database/database.module';
import { DocumentsModule } from '../documents/documents.module';
import { AiModule } from '../ai/ai.module';
import { ExtractionService } from './extraction.service';
import { IngestionPersistence } from './ingestion-persistence';
import { IngestionRunner } from './ingestion-runner';
@Module({
  imports: [ConfigModule, DatabaseModule, DocumentsModule, AiModule],
  providers: [ExtractionService, IngestionPersistence, IngestionRunner],
})
export class IngestionModule {}
