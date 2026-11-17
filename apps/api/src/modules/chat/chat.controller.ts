import {
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { invalidRequest } from '../../api-error';
import { ChatService } from './chat.service';
import { AskAdmissionGuard } from './ask-admission.guard';

@Controller('chat')
@UseGuards(AskAdmissionGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}
  @Post('ask')
  @HttpCode(200)
  async ask(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (Object.keys(request.query).length || !request.is('application/json'))
      throw invalidRequest();
    const disconnect = new AbortController();
    const cancel = () => {
      if (!response.writableFinished) disconnect.abort();
    };
    response.once('close', cancel);
    try {
      return await this.chat.ask(request.body, disconnect.signal);
    } finally {
      response.off('close', cancel);
    }
  }
}
