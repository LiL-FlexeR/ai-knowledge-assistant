import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module';
import { DatabaseModule } from '../../database/database.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { LocalDocumentStore } from './local-document-store';
import { UploadReceiver } from './upload-receiver';
import { DocumentAdmissionGuard } from './document-admission.guard';
import { DocumentCleanupService } from './document-cleanup.service';
import { DocumentWorkSignals } from './document-work-signals';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    LocalDocumentStore,
    UploadReceiver,
    DocumentAdmissionGuard,
    DocumentCleanupService,
    DocumentWorkSignals,
  ],
  exports: [DocumentsService, LocalDocumentStore, DocumentWorkSignals],
})
export class DocumentsModule {}
