import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthService, AdminPrincipal } from './admin-auth.service';
import { AdminGuard, clientActor, CurrentAdmin } from './admin.guard';
import { LoginDto, RefreshDto } from './dto/auth.dto';

@ApiTags('admin')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login') @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: any) {
    return this.auth.login(dto.username, dto.password, clientActor(req), req.headers['user-agent']);
  }

  @Post('refresh') @HttpCode(200)
  refresh(@Body() dto: RefreshDto, @Req() req: any) {
    return this.auth.refresh(dto.refreshToken, clientActor(req));
  }

  @Post('logout') @HttpCode(204) @UseGuards(AdminGuard)
  async logout(@CurrentAdmin() admin: AdminPrincipal, @Req() req: any) {
    await this.auth.logout(admin, clientActor(req));
  }

  @Get('me') @UseGuards(AdminGuard)
  me(@CurrentAdmin() a: AdminPrincipal) {
    return { admin: { id: a.adminId, username: a.username, roles: a.roles, permissions: a.permissions } };
  }
}
