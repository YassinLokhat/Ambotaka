import { Module } from '@nestjs/common';
import { InstallationGuard } from '../../shared/installation/installation.guard';
import { PrivacyModule } from '../privacy/privacy.module';
import { NavigationModule } from '../navigation/navigation.module';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';

@Module({
  imports: [NavigationModule, PrivacyModule],
  controllers: [RecommendationsController],
  providers: [RecommendationsService, InstallationGuard],
})
export class RecommendationsModule {}
