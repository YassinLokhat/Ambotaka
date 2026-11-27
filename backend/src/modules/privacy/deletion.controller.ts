import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InstallationGuard, InstallationId } from '../../shared/installation/installation.guard';
import { DeletionService } from './deletion.service';
import { CreateDeletionDto } from './dto/deletion.dto';

@ApiTags('privacy')
@Controller('deletion-requests')
@UseGuards(InstallationGuard)
export class DeletionController {
  constructor(private readonly service: DeletionService) {}

  @Post() @HttpCode(200)
  create(@InstallationId() inst: string, @Body() dto: CreateDeletionDto) {
    return this.service.create(inst, dto.idempotencyKey, dto.types).then((request) => ({ request }));
  }

  @Get()
  list(@InstallationId() inst: string) { return this.service.list(inst); }

  @Get(':id')
  async get(@InstallationId() inst: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return { request: await this.service.get(inst, id) };
  }
}
