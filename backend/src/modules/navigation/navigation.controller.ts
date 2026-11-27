import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PlaceSearchDto, RouteSearchDto } from './dto/navigation.dto';
import { RoutesService } from './routes.service';

@ApiTags('navigation')
@Controller()
export class NavigationController {
  constructor(private readonly service: RoutesService) {}

  @Post('routes/search')
  @HttpCode(200)
  searchRoutes(@Body() dto: RouteSearchDto) {
    return this.service.searchRoutes(dto.origin, dto.destination, dto.originAccuracyMeters);
  }

  @Get('places/search')
  searchPlaces(@Query() q: PlaceSearchDto) {
    const near = q.lat !== undefined && q.lon !== undefined ? { lat: q.lat, lon: q.lon } : undefined;
    return this.service.searchPlaces(q.q, near);
  }
}
