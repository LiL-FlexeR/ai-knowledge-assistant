import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module';
import { AiCapacity } from './ai-capacity';
import { EmbeddingClient } from './embedding-client';
import { OpenAIEmbeddingClient } from './openai-embedding-client';
import { GroundedAnswerClient } from './grounded-answer-client';
import { OpenAIGroundedAnswerClient } from './openai-grounded-answer-client';
@Module({
  imports: [ConfigModule],
  providers: [
    AiCapacity,
    { provide: EmbeddingClient, useClass: OpenAIEmbeddingClient },
    { provide: GroundedAnswerClient, useClass: OpenAIGroundedAnswerClient },
  ],
  exports: [EmbeddingClient, GroundedAnswerClient, AiCapacity],
})
export class AiModule {}
