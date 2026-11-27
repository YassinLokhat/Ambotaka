import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { DatabaseService } from '../../shared/database/database.service';
import { ParametersService } from '../../shared/parameters/parameters.service';
import { AdminPrincipal } from './admin-auth.service';
import { AuditService } from './audit.service';

// Paramètres qui sont des proportions : bornés à [0, 1].
const RATIO_KEYS = new Set([
  'incident.confirmThreshold', 'reco.minGainRatio', 'reco.minConfidence', 'reco.minRouteMatch', 'reco.minTrafficConfidence',
  'reco.minIncidentConfidence', 'traffic.fluidRatio', 'traffic.slowRatio', 'monitor.errorRate',
]);

@Injectable()
export class AdminConfigService {
  constructor(private readonly db: DatabaseService, private readonly params: ParametersService, private readonly audit: AuditService) {}

  async list() {
    const { rows } = await this.db.query('SELECT key, value, description, updated_at FROM system_parameters ORDER BY key');
    return { parameters: rows.map((r) => ({ key: r.key, value: r.value, description: r.description, updatedAt: r.updated_at, isRatio: RATIO_KEYS.has(r.key) })) };
  }

  /** Atomique : toutes les modifications sont validées puis appliquées, avec historique et audit (ancienne/nouvelle valeur). */
  async update(by: AdminPrincipal, ip: string | undefined, changes: { key: string; value: number }[]) {
    const keys = changes.map((c) => c.key);
    const current = new Map((await this.db.query('SELECT key, value FROM system_parameters WHERE key = ANY($1)', [keys])).rows.map((r) => [r.key, r.value]));
    for (const c of changes) {
      if (!current.has(c.key)) throw new UnprocessableEntityException({ code: 'UNKNOWN_PARAMETER', message: `Paramètre inconnu : ${c.key}` });
      if (RATIO_KEYS.has(c.key) && c.value > 1) throw new UnprocessableEntityException({ code: 'INVALID_VALUE', message: `${c.key} doit être compris entre 0 et 1.` });
    }
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      for (const c of changes) {
        await client.query('UPDATE system_parameters SET value=$2, updated_at=now() WHERE key=$1', [c.key, JSON.stringify(c.value)]);
        await client.query(`INSERT INTO configuration_history (key, old_value, new_value, admin_id, admin_username) VALUES ($1,$2,$3,$4,$5)`,
          [c.key, JSON.stringify(current.get(c.key)), JSON.stringify(c.value), by.adminId, by.username]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    this.params.invalidate();
    await this.audit.log({ adminId: by.adminId, username: by.username, ip }, 'CONFIG_CHANGED', 'system_parameters',
      { changes: changes.map((c) => ({ key: c.key, from: current.get(c.key), to: c.value })) });
    return this.list();
  }
}
