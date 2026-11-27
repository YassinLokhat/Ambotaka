import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InstallationGuard, InstallationId, UUID_RE } from '../../shared/installation/installation.guard';
import { ConfirmationDto, CreateReportDto, IncidentQueryDto } from './dto/incidents.dto';
import { IncidentsService } from './incidents.service';

const optionalInstallation = (h?: string) => (h && UUID_RE.test(h) ? h.toLowerCase() : undefined);

@ApiTags('incidents')
@Controller()
export class IncidentsController {
  constructor(private readonly service: IncidentsService) {}

  @Post('reports')
  @UseGuards(InstallationGuard)
  createReport(@InstallationId() installationId: string, @Body() dto: CreateReportDto) {
    return this.service.createReport(installationId, dto);
  }

  @Get('incidents')
  list(@Query() q: IncidentQueryDto, @Headers('x-installation-id') h?: string) {
    return this.service.list(q.lat, q.lon, q.radiusMeters, optionalInstallation(h));
  }

  @Get('incidents/:id')
  get(@Param('id', new ParseUUIDPipe()) id: string, @Headers('x-installation-id') h?: string) {
    return this.service.get(id, optionalInstallation(h));
  }

  @Post('incidents/:id/confirmations')
  @UseGuards(InstallationGuard)
  respond(@InstallationId() installationId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ConfirmationDto) {
    return this.service.respond(installationId, id, dto.kind);
  }
}
