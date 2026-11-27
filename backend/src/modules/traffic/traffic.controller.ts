import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InstallationGuard, InstallationId } from '../../shared/installation/installation.guard';
import { ObservationBatchDto, TrafficQueryDto } from './dto/traffic.dto';
import { TrafficService } from './traffic.service';

@ApiTags('traffic')
@Controller()
export class TrafficController {
  constructor(private readonly service: TrafficService) {}

  @Post('traffic-observations')
  @HttpCode(200)
  @UseGuards(InstallationGuard)
  ingest(@InstallationId() id: string, @Body() dto: ObservationBatchDto) {
    return this.service.ingest(id, dto.observations, dto.appVersion);
  }

  @Get('traffic')
  traffic(@Query() q: TrafficQueryDto) {
    return this.service.getTraffic(q.lat, q.lon, q.radiusMeters);
  }
}
