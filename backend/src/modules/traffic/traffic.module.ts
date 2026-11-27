import { Module } from '@nestjs/common';
import { InstallationGuard } from '../../shared/installation/installation.guard';
import { PrivacyModule } from '../privacy/privacy.module';
import { AggregationService } from './aggregation.service';
import { TrafficController } from './traffic.controller';
import { TrafficService } from './traffic.service';

@Module({
  imports: [PrivacyModule],
  controllers: [TrafficController],
  providers: [TrafficService, AggregationService, InstallationGuard],
  exports: [AggregationService],
})
export class TrafficModule {}
