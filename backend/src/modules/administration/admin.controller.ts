import { Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminConfigService } from './admin-config.service';
import { AdminOpsService } from './admin-ops.service';
import { AdminPrincipal } from './admin-auth.service';
import { AdminUsersService } from './admin-users.service';
import { AdminGuard, CurrentAdmin, RequirePermissions } from './admin.guard';
import { AuditService } from './audit.service';
import {
  AuditQueryDto, CreateRoleDto, CreateUserDto, ModerateIncidentDto, UpdateConfigDto, UpdatePermissionDto, UpdateRoleDto, UpdateUserDto,
} from './dto/admin.dto';
import { ParametersService } from '../../shared/parameters/parameters.service';

@ApiTags('admin')
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly users: AdminUsersService, private readonly config: AdminConfigService, private readonly ops: AdminOpsService,
    private readonly audit: AuditService, private readonly params: ParametersService,
  ) {}

  @Get('users') @RequirePermissions('admin.users.read') listUsers() { return this.users.listUsers(); }
  @Post('users') @RequirePermissions('admin.users.write')
  createUser(@CurrentAdmin() a: AdminPrincipal, @Req() r: any, @Body() dto: CreateUserDto) { return this.users.createUser(a, r.ip, dto); }
  @Patch('users/:id') @RequirePermissions('admin.users.write')
  updateUser(@CurrentAdmin() a: AdminPrincipal, @Req() r: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateUserDto) {
    return this.users.updateUser(a, r.ip, id, dto);
  }

  @Get('roles') @RequirePermissions('admin.roles.read') listRoles() { return this.users.listRoles(); }
  @Post('roles') @RequirePermissions('admin.roles.write')
  createRole(@CurrentAdmin() a: AdminPrincipal, @Req() r: any, @Body() dto: CreateRoleDto) { return this.users.createRole(a, r.ip, dto); }
  @Patch('roles/:id') @RequirePermissions('admin.roles.write')
  updateRole(@CurrentAdmin() a: AdminPrincipal, @Req() r: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateRoleDto) {
    return this.users.updateRole(a, r.ip, id, dto);
  }
  @Get('permissions') @RequirePermissions('admin.roles.read') listPermissions() { return this.users.listPermissions(); }
  @Patch('permissions/:code') @RequirePermissions('admin.roles.write')
  updatePermission(@CurrentAdmin() a: AdminPrincipal, @Req() r: any, @Param('code') code: string, @Body() dto: UpdatePermissionDto) {
    return this.users.updatePermission(a, r.ip, code, dto.description);
  }

  @Get('configuration') @RequirePermissions('admin.config.read') getConfig() { return this.config.list(); }
  @Patch('configuration') @RequirePermissions('admin.config.write')
  updateConfig(@CurrentAdmin() a: AdminPrincipal, @Req() r: any, @Body() dto: UpdateConfigDto) { return this.config.update(a, r.ip, dto.changes); }

  @Get('audit-logs') @RequirePermissions('admin.audit.read')
  auditLogs(@Query() q: AuditQueryDto) { return this.audit.list({ limit: q.limit ?? 50, cursor: q.cursor, action: q.action, admin: q.admin }); }

  @Get('community/incidents') @RequirePermissions('admin.community.read')
  community(@Query('status') status?: string, @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit = 100) {
    return this.ops.listCommunityIncidents(status, Math.min(limit, 200));
  }
  @Patch('community/incidents/:id') @RequirePermissions('admin.community.write')
  moderate(@CurrentAdmin() a: AdminPrincipal, @Req() r: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ModerateIncidentDto) {
    return this.ops.moderateIncident(a, r.ip, id, dto.action);
  }

  @Get('traffic/summary') @RequirePermissions('admin.traffic.read') traffic() { return this.ops.trafficSummary(); }
  @Get('privacy/deletions') @RequirePermissions('admin.privacy.read')
  async deletions() { return this.ops.deletionsSummary((await this.params.get())['monitor.deletionStuckHours']); }
}
