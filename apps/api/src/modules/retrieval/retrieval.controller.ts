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
import { RetrievalService } from './retrieval.service';
import { SearchAdmissionGuard } from './search-admission.guard';

@Controller('search')
@UseGuards(SearchAdmissionGuard)
export class RetrievalController {
  constructor(private readonly retrieval: RetrievalService) {}
  @Post()
  @HttpCode(200)
  async search(
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
      return await this.retrieval.search(request.body, disconnect.signal);
    } finally {
      response.off('close', cancel);
    }
  }
}
