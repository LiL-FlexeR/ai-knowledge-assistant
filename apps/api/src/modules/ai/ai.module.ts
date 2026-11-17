import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module';
import { AiCapacity } from './ai-capacity';
import { EmbeddingClient } from './embedding-client';
import { OpenAIEmbeddingClient } from './openai-embedding-client';
@Module({
  imports: [ConfigModule],
  providers: [
    AiCapacity,
    { provide: EmbeddingClient, useClass: OpenAIEmbeddingClient },
  ],
  exports: [EmbeddingClient, AiCapacity],
})
export class AiModule {}
