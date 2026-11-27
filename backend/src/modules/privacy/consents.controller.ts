import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InstallationGuard, InstallationId } from '../../shared/installation/installation.guard';
import { ConsentsService } from './consents.service';
import { StatisticsConsentDto } from './dto/consent.dto';

@ApiTags('privacy')
@Controller('consents')
@UseGuards(InstallationGuard)
export class ConsentsController {
  constructor(private readonly service: ConsentsService) {}

  @Get()
  async get(@InstallationId() id: string) {
    return { statistics: await this.service.statistics(id) };
  }

  @Put('statistics')
  async put(@InstallationId() id: string, @Body() dto: StatisticsConsentDto) {
    return { statistics: await this.service.setStatistics(id, dto.granted, dto.policyVersion) };
  }
}
