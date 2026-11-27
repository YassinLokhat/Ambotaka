import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../shared/database/database.service';

export interface Actor { adminId?: string | null; username?: string | null; ip?: string | null }

/** ADM-004 : toute action sensible laisse une trace append-only (un trigger SQL interdit UPDATE/DELETE/TRUNCATE). */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');
  constructor(private readonly db: DatabaseService) {}

  async log(actor: Actor, action: string, resource?: string, details: Record<string, unknown> = {}) {
    try {
      await this.db.query(
        `INSERT INTO audit_logs (admin_id, admin_username, action, resource, details, ip) VALUES ($1,$2,$3,$4,$5,$6)`,
        [actor.adminId ?? null, actor.username ?? null, action, resource ?? null, JSON.stringify(details), actor.ip ?? null]);
    } catch (e) {
      // Un échec d'audit ne doit pas masquer l'action, mais il doit être visible côté exploitation.
      this.logger.error(`Échec d'écriture du journal d'audit (${action}): ${(e as Error).message}`);
    }
  }

  /** Pagination par curseur (at, id) : stable même si de nouvelles entrées arrivent. */
  async list(opts: { limit: number; cursor?: string; action?: string; admin?: string }) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (opts.action) { params.push(opts.action); where.push(`action = $${params.length}`); }
    if (opts.admin) { params.push(opts.admin); where.push(`admin_username = $${params.length}`); }
    if (opts.cursor) {
      const [at, id] = Buffer.from(opts.cursor, 'base64url').toString().split('|');
      params.push(at, Number(id));
      where.push(`(at, id) < ($${params.length - 1}::timestamptz, $${params.length}::bigint)`);
    }
    params.push(opts.limit + 1);
    const { rows } = await this.db.query(
      `SELECT id, at, admin_id, admin_username, action, resource, details, ip FROM audit_logs
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY at DESC, id DESC LIMIT $${params.length}`, params);
    const page = rows.slice(0, opts.limit);
    const last = page[page.length - 1];
    return {
      entries: page.map((r) => ({ id: Number(r.id), at: r.at, adminId: r.admin_id, adminUsername: r.admin_username, action: r.action, resource: r.resource, details: r.details, ip: r.ip })),
      nextCursor: rows.length > opts.limit && last ? Buffer.from(`${new Date(last.at).toISOString()}|${last.id}`).toString('base64url') : null,
    };
  }
}
