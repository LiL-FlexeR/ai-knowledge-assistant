import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module';
import { DatabaseModule } from '../../database/database.module';
import { AiModule } from '../ai/ai.module';
import { RetrievalController } from './retrieval.controller';
import { RetrievalService } from './retrieval.service';
import { SearchAdmissionGuard } from './search-admission.guard';
import { VectorReader } from './vector-reader';

@Module({
  imports: [ConfigModule, DatabaseModule, AiModule],
  controllers: [RetrievalController],
  providers: [RetrievalService, SearchAdmissionGuard, VectorReader],
  exports: [RetrievalService],
})
export class RetrievalModule {}
