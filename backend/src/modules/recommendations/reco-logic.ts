import { AppParams } from '../../shared/parameters/parameters.service';
import { angleDiff } from '../traffic/traffic-logic';

export interface Evidence {
  kind: 'TRAFFIC' | 'INCIDENT';
  delaySeconds: number;
  confidence: number;
  label: string;
  distanceAheadMeters?: number;
}

export interface TrafficRow {
  mean_speed_kph: number; free_flow_kph: number | null; direction: number; seg_len: number;
  seg_az: number; route_az: number; confidence: number;
}

/**
 * Retard dû à un tronçon mesuré. La référence est min(vitesse libre, vitesse moyenne déjà supposée par le fournisseur
 * sur cet itinéraire) : on ne compte pas deux fois un ralentissement que le fournisseur a déjà intégré.
 */
export function trafficDelaySeconds(r: TrafficRow, routeAvgKph: number): number {
  if (!r.free_flow_kph || r.free_flow_kph <= 0) return 0; // pas de référence => pas d'estimation
  const base = Math.min(r.free_flow_kph, routeAvgKph);
  const obs = Math.max(r.mean_speed_kph, 3);
  return Math.max(0, r.seg_len / (obs / 3.6) - r.seg_len / (base / 3.6));
}

/** Un agrégat de sens 0 s'applique aux deux sens ; sinon le sens doit correspondre à celui de l'itinéraire. */
export function directionMatches(statDirection: number, segAz: number, routeAz: number): boolean {
  if (statDirection === 0) return true;
  const routeDir = angleDiff(routeAz, segAz) <= 90 ? 1 : -1;
  return statDirection === routeDir;
}

/** Confiance = moyenne des confiances des preuves pondérée par leur retard (formule initiale à calibrer). */
export function evidenceConfidence(ev: Evidence[]): number {
  const total = ev.reduce((s, e) => s + e.delaySeconds, 0);
  if (total <= 0) return 0;
  return Math.round((ev.reduce((s, e) => s + e.delaySeconds * e.confidence, 0) / total) * 100) / 100;
}

export type NoRecoReason = 'NO_DATA' | 'NO_BETTER_ROUTE' | 'LOW_CONFIDENCE';

export function decide(
  currentAdjusted: number, bestAltAdjusted: number, currentEvidence: Evidence[], p: AppParams,
): { ok: true; gain: number; confidence: number } | { ok: false; reason: NoRecoReason } {
  if (!currentEvidence.some((e) => e.delaySeconds > 0)) return { ok: false, reason: 'NO_DATA' }; // REC-005
  const gain = currentAdjusted - bestAltAdjusted;
  if (gain < p['reco.minGainSeconds'] || gain < p['reco.minGainRatio'] * currentAdjusted) {
    return { ok: false, reason: 'NO_BETTER_ROUTE' };
  }
  const confidence = evidenceConfidence(currentEvidence);
  if (confidence < p['reco.minConfidence']) return { ok: false, reason: 'LOW_CONFIDENCE' };
  return { ok: true, gain: Math.round(gain), confidence };
}

export function formatMotif(gainSeconds: number, evidence: Evidence[]): string {
  const mins = Math.max(1, Math.round(gainSeconds / 60));
  const parts = evidence.filter((e) => e.delaySeconds > 0).sort((a, b) => b.delaySeconds - a.delaySeconds)
    .slice(0, 2).map((e) => e.label);
  return `Gain estimé : ${mins} min. ${parts.join(' ; ')}.`;
}

/** Intervalle minimal entre deux évaluations (horloge injectable pour les tests). */
export class MinIntervalLimiter {
  private last = new Map<string, number>();
  constructor(private now: () => number = Date.now) {}
  allow(key: string, intervalMs: number): boolean {
    const t = this.now(), prev = this.last.get(key);
    if (this.last.size > 1000) for (const [k, v] of this.last) if (t - v > 3_600_000) this.last.delete(k);
    if (prev !== undefined && t - prev < intervalMs) return false;
    this.last.set(key, t);
    return true;
  }
}
