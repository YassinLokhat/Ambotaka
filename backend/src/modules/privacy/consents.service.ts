import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../shared/database/database.service';
import { ErasureRegistry } from './erasure';

@Injectable()
export class ConsentsService {
  constructor(private readonly db: DatabaseService, private readonly registry: ErasureRegistry) {}

  async statistics(installationId: string) {
    const { rows } = await this.db.query(
      `SELECT granted, decided_at, policy_version FROM statistical_consents
       WHERE installation_id=$1 ORDER BY decided_at DESC LIMIT 1`, [installationId]);
    const r = rows[0];
    return { granted: r ? (r.granted as boolean) : null, decidedAt: r?.decided_at ?? null, policyVersion: r?.policy_version ?? null };
  }

  async isStatisticsGranted(installationId: string) {
    return (await this.statistics(installationId)).granted === true;
  }

  /** PRI-001..003 : décision tracée ; idempotent ; le retrait efface les données brutes (TRF-009). */
  async setStatistics(installationId: string, granted: boolean, policyVersion: string) {
    const current = await this.statistics(installationId);
    if (current.granted !== granted) {
      await this.db.query(
        `INSERT INTO statistical_consents (installation_id, granted, policy_version) VALUES ($1,$2,$3)`,
        [installationId, granted, policyVersion]);
    }
    // Retrait : suppression des observations brutes (TRF-009), rejouable sans effet secondaire.
    if (!granted && this.registry.has('GPS_OBSERVATIONS')) await this.registry.erase('GPS_OBSERVATIONS', installationId);
    return this.statistics(installationId);
  }
}
