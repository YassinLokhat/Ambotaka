import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { DatabaseService } from '../../shared/database/database.service';
import { ErasureRegistry, ErasureType } from './erasure';

const view = (r: any) => ({
  id: r.id, status: r.status as 'EN_COURS' | 'CONFIRMEE' | 'ECHEC', types: r.types as string[],
  items: r.result?.items ?? [], installationRemoved: r.result?.installationRemoved ?? false,
  createdAt: r.created_at, completedAt: r.completed_at,
});

@Injectable()
export class DeletionService {
  constructor(private readonly db: DatabaseService, private readonly registry: ErasureRegistry) {}

  /**
   * PRI-005..008, NFR-008 : idempotente (même clé => même résultat, sans nouvelle suppression), limitée à
   * l'installation appelante, « CONFIRMEE » seulement après exécution complète côté serveur.
   */
  async create(installationId: string, idempotencyKey: string, requested: string[]) {
    const isAll = requested.includes('ALL');
    const types: string[] = isAll ? ['ALL'] : [...new Set(requested)].sort();

    const existing = (await this.db.query(
      `SELECT * FROM deletion_requests WHERE installation_id=$1 AND idempotency_key=$2`, [installationId, idempotencyKey])).rows[0];
    if (existing) {
      if (JSON.stringify(existing.types) !== JSON.stringify(types)) {
        throw new UnprocessableEntityException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'Cette clé a déjà servi pour une autre demande.' });
      }
      if (existing.status === 'CONFIRMEE') return view(existing); // rejeu : aucun effet secondaire
    }
    const row = existing ?? (await this.db.query(
      `INSERT INTO deletion_requests (installation_id, idempotency_key, types) VALUES ($1,$2,$3) RETURNING *`,
      [installationId, idempotencyKey, types])).rows[0];

    await this.db.query(`UPDATE deletion_requests SET status='EN_COURS', attempts=attempts+1 WHERE id=$1`, [row.id]);
    try {
      const toErase: ErasureType[] = isAll ? this.registry.registered() : (types as ErasureType[]);
      const items: { type: string; status: 'CONFIRMEE'; deletedCount: number }[] = [];
      for (const t of toErase) items.push({ type: t, status: 'CONFIRMEE', deletedCount: await this.registry.erase(t, installationId) });
      if (isAll) await this.db.query('DELETE FROM driver_installations WHERE id=$1', [installationId]); // cascade : consentements, etc.
      const done = (await this.db.query(
        `UPDATE deletion_requests SET status='CONFIRMEE', completed_at=now(), result=$2 WHERE id=$1 RETURNING *`,
        [row.id, JSON.stringify({ items, installationRemoved: isAll })])).rows[0];
      return view(done);
    } catch {
      await this.db.query(`UPDATE deletion_requests SET status='ECHEC' WHERE id=$1`, [row.id]);
      throw new ServiceUnavailableException({ code: 'DELETION_FAILED', message: 'La suppression n’a pas pu aboutir. Elle sera réessayée.' });
    }
  }

  async get(installationId: string, id: string) {
    const r = (await this.db.query(`SELECT * FROM deletion_requests WHERE id=$1 AND installation_id=$2`, [id, installationId])).rows[0];
    if (!r) throw new NotFoundException({ code: 'DELETION_REQUEST_NOT_FOUND', message: 'Demande introuvable.' });
    return view(r);
  }

  async list(installationId: string) {
    const { rows } = await this.db.query(
      `SELECT * FROM deletion_requests WHERE installation_id=$1 ORDER BY created_at DESC LIMIT 20`, [installationId]);
    return { requests: rows.map(view) };
  }
}
