import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module';
import { AiModule } from '../ai/ai.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { AskAdmissionGuard } from './ask-admission.guard';

@Module({
  imports: [ConfigModule, AiModule, RetrievalModule],
  controllers: [ChatController],
  providers: [ChatService, AskAdmissionGuard],
  exports: [ChatService],
})
export class ChatModule {}
