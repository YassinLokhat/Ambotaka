import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InstallationGuard, InstallationId } from '../../shared/installation/installation.guard';
import { DecisionDto, EvaluateDto } from './dto/recommendations.dto';
import { RecommendationsService } from './recommendations.service';

@ApiTags('recommendations')
@Controller('recommendations')
@UseGuards(InstallationGuard)
export class RecommendationsController {
  constructor(private readonly service: RecommendationsService) {}

  @Post('evaluate')
  @HttpCode(200)
  evaluate(@InstallationId() id: string, @Body() dto: EvaluateDto) {
    return this.service.evaluate(id, dto);
  }

  @Get()
  list(@InstallationId() id: string, @Query('sessionId') sessionId?: string) {
    return this.service.list(id, sessionId);
  }

  @Patch(':id/decision')
  decide(@InstallationId() inst: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: DecisionDto) {
    return this.service.decide(inst, id, dto.decision);
  }
}
