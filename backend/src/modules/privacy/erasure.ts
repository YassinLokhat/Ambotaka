import { Injectable } from '@nestjs/common';

export const ERASURE_TYPES = ['GPS_OBSERVATIONS', 'INCIDENT_CONTRIBUTIONS', 'RECOMMENDATIONS'] as const;
export type ErasureType = (typeof ERASURE_TYPES)[number];
/** Retourne le nombre d'éléments supprimés. Doit être rejouable sans effet secondaire. */
export type Eraser = (installationId: string) => Promise<number>;

/** Chaque domaine enregistre comment effacer SES données ; aucun domaine n'importe les internes d'un autre. */
@Injectable()
export class ErasureRegistry {
  private erasers = new Map<ErasureType, Eraser>();
  register(type: ErasureType, fn: Eraser) { this.erasers.set(type, fn); }
  has(type: ErasureType) { return this.erasers.has(type); }
  registered(): ErasureType[] { return ERASURE_TYPES.filter((t) => this.erasers.has(t)); }
  async erase(type: ErasureType, installationId: string): Promise<number> {
    const fn = this.erasers.get(type);
    if (!fn) throw new Error(`Aucun effaceur enregistré pour ${type}`);
    return fn(installationId);
  }
}
