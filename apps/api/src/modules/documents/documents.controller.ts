import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { documentListQuerySchema } from '@aka/shared';
import { invalidRequest } from '../../api-error';
import { DocumentAdmissionGuard } from './document-admission.guard';
import { DocumentsService } from './documents.service';

function documentId(id: string) {
  const result = z.uuid().safeParse(id);
  if (!result.success) throw invalidRequest();
  return result.data;
}

@Controller('documents')
@UseGuards(DocumentAdmissionGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}
  @Post()
  async upload(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (Object.keys(request.query).length) throw invalidRequest();
    const disconnect = new AbortController();
    const cancel = () => {
      if (!response.writableFinished) disconnect.abort();
    };
    response.once('close', cancel);
    try {
      const document = await this.documents.upload(request, disconnect.signal);
      response.setHeader('Location', `/api/documents/${document.id}`);
      return document;
    } finally {
      response.off('close', cancel);
    }
  }
  @Get()
  list(@Query() query: unknown) {
    const result = documentListQuerySchema.safeParse(query);
    if (!result.success) throw invalidRequest();
    return this.documents.list(result.data);
  }
  @Get(':id')
  detail(@Param('id') id: string, @Query() query: Record<string, unknown>) {
    if (Object.keys(query).length) throw invalidRequest();
    return this.documents.detail(documentId(id));
  }
  @Delete(':id')
  @HttpCode(204)
  delete(@Param('id') id: string, @Req() request: Request) {
    if (
      Object.keys(request.query).length ||
      request.body !== undefined ||
      Number(request.headers['content-length'] ?? 0) > 0 ||
      request.headers['transfer-encoding']
    )
      throw invalidRequest();
    return this.documents.delete(documentId(id));
  }
  @Post(':id/reprocess')
  @HttpCode(202)
  async reprocess(
    @Param('id') id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (
      Object.keys(request.query).length ||
      request.body !== undefined ||
      Number(request.headers['content-length'] ?? 0) > 0 ||
      request.headers['transfer-encoding']
    )
      throw invalidRequest();
    const document = await this.documents.reprocess(documentId(id));
    response.setHeader('Location', `/api/documents/${document.id}`);
    return document;
  }
}
