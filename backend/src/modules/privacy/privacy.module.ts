import { Module } from '@nestjs/common';
import { InstallationGuard } from '../../shared/installation/installation.guard';
import { ConsentsController } from './consents.controller';
import { ConsentsService } from './consents.service';
import { DeletionController } from './deletion.controller';
import { DeletionService } from './deletion.service';
import { ErasureRegistry } from './erasure';

@Module({
  controllers: [ConsentsController, DeletionController],
  providers: [ConsentsService, DeletionService, ErasureRegistry, InstallationGuard],
  exports: [ConsentsService, ErasureRegistry],
})
export class PrivacyModule {}
