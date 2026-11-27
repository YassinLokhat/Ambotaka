import { Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminPrincipal } from '../administration/admin-auth.service';
import { AdminGuard, CurrentAdmin, RequirePermissions } from '../administration/admin.guard';
import { AuditService } from '../administration/audit.service';
import { DatabaseService } from '../../shared/database/database.service';
import { AlertQueryDto, MetricsQueryDto, TechIncidentQueryDto, UpdateTechIncidentDto } from './dto/monitoring.dto';
import { MonitoringService } from './monitoring.service';

// MON-003/004 : incidents techniques et alertes visibles par les administrateurs autorisés.
const TRANSITIONS: Record<string, string[]> = { OUVERT: ['EN_COURS', 'RESOLU'], EN_COURS: ['RESOLU'], RESOLU: ['CLOTURE'], CLOTURE: [] };

@ApiTags('admin')
@Controller('admin')
@UseGuards(AdminGuard)
export class MonitoringAdminController {
  constructor(private readonly mon: MonitoringService, private readonly db: DatabaseService, private readonly audit: AuditService) {}

  @Get('services') @RequirePermissions('admin.metrics.read')
  async services() {
    if (!this.mon.last) await this.mon.tick().catch(() => undefined); // premier appel avant le premier cycle
    const l = this.mon.last;
    return l ? { at: l.at, services: l.services, sample: l.sample } : { at: null, services: [], sample: null };
  }

  @Get('metrics') @RequirePermissions('admin.metrics.read')
  async metrics(@Query() q: MetricsQueryDto) {
    const { rows } = await this.db.query(
      `SELECT at, value, unit FROM system_metrics WHERE name=$1 AND at > now() - make_interval(mins => $2) ORDER BY at`, [q.name, q.minutes ?? 60]);
    return { name: q.name, unit: rows[0]?.unit ?? null, points: rows.map((r) => ({ at: r.at, value: r.value })) };
  }

  @Get('technical-incidents') @RequirePermissions('admin.tech.read')
  async incidents(@Query() q: TechIncidentQueryDto) {
    const { rows } = await this.db.query(
      `SELECT * FROM technical_incidents WHERE ($1::text IS NULL OR status=$1) ORDER BY (status IN ('OUVERT','EN_COURS')) DESC, last_seen_at DESC LIMIT 100`, [q.status ?? null]);
    return { incidents: rows.map((r) => ({
      id: r.id, rule: r.rule, service: r.service, title: r.title, description: r.description, severity: r.severity, status: r.status,
      openedAt: r.opened_at, lastSeenAt: r.last_seen_at, occurrences: r.occurrences, resolvedAt: r.resolved_at, resolvedBy: r.resolved_by })) };
  }

  @Patch('technical-incidents/:id') @RequirePermissions('admin.tech.write')
  async updateIncident(@CurrentAdmin() a: AdminPrincipal, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateTechIncidentDto) {
    const cur = (await this.db.query('SELECT status FROM technical_incidents WHERE id=$1', [id])).rows[0];
    if (!cur) throw new NotFoundException({ code: 'TECH_INCIDENT_NOT_FOUND', message: 'Incident technique introuvable.' });
    if (!TRANSITIONS[cur.status].includes(dto.status)) {
      throw new ConflictException({ code: 'INVALID_TRANSITION', message: `Transition ${cur.status} → ${dto.status} impossible.` });
    }
    await this.db.query(
      `UPDATE technical_incidents SET status=$2, resolved_at = CASE WHEN $2='RESOLU' THEN now() ELSE resolved_at END,
         resolved_by = CASE WHEN $2='RESOLU' THEN $3 ELSE resolved_by END WHERE id=$1`, [id, dto.status, a.username]);
    await this.audit.log({ adminId: a.adminId, username: a.username, ip: req.ip }, 'TECH_INCIDENT_UPDATED', `technical_incident:${id}`, { from: cur.status, to: dto.status });
    return { id, status: dto.status };
  }

  @Get('alerts') @RequirePermissions('admin.tech.read')
  async alerts(@Query() q: AlertQueryDto) {
    const { rows } = await this.db.query(
      `SELECT a.*, i.title, i.service FROM technical_alerts a JOIN technical_incidents i ON i.id = a.incident_id
       WHERE ($1::boolean IS NULL OR (a.acknowledged_at IS NOT NULL) = $1) ORDER BY a.created_at DESC LIMIT 100`, [q.acknowledged ?? null]);
    return { alerts: rows.map((r) => ({ id: r.id, incidentId: r.incident_id, title: r.title, service: r.service, message: r.message,
      severity: r.severity, createdAt: r.created_at, acknowledgedAt: r.acknowledged_at, acknowledgedBy: r.acknowledged_by })) };
  }

  @Patch('alerts/:id/acknowledge') @RequirePermissions('admin.tech.write')
  async acknowledge(@CurrentAdmin() a: AdminPrincipal, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.db.query(
      `UPDATE technical_alerts SET acknowledged_at=COALESCE(acknowledged_at, now()), acknowledged_by=COALESCE(acknowledged_by, $2) WHERE id=$1 RETURNING acknowledged_at`, [id, a.username]);
    if (!r.rowCount) throw new NotFoundException({ code: 'ALERT_NOT_FOUND', message: 'Alerte introuvable.' });
    await this.audit.log({ adminId: a.adminId, username: a.username, ip: req.ip }, 'ALERT_ACKNOWLEDGED', `technical_alert:${id}`);
    return { id, acknowledgedAt: r.rows[0].acknowledged_at };
  }
}
