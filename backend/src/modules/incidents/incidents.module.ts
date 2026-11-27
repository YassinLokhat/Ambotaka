import { Module } from '@nestjs/common';
import { InstallationGuard } from '../../shared/installation/installation.guard';
import { PrivacyModule } from '../privacy/privacy.module';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';

@Module({ imports: [PrivacyModule], controllers: [IncidentsController], providers: [IncidentsService, InstallationGuard] })
export class IncidentsModule {}
