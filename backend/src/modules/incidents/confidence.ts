import { IncidentParams } from '../../shared/parameters/parameters.service';

export type IncidentStatus = 'DETECTE' | 'CONFIRME' | 'EN_COURS' | 'RESOLU' | 'EXPIRE';
export interface Evidence { reporters: number; confirmations: number; contestations: number }

/** Score = déclarants distincts + confirmations − poids × contestations. Formule initiale, à calibrer. */
export function computeScore(e: Evidence, p: IncidentParams): number {
  return e.reporters + e.confirmations - p['incident.contestationWeight'] * e.contestations;
}

export function computeConfidence(score: number, p: IncidentParams): number {
  return Math.max(0, Math.min(1, score / p['incident.scoreForFullConfidence']));
}

/**
 * Transitions automatiques :
 * - DETECTE -> CONFIRME si confiance >= seuil (INC-010 : un seul signalement ne suffit pas) ;
 * - tout incident actif -> EXPIRE si score <= seuil de rejet avec assez de contestations ;
 * - RESOLU / EXPIRE sont terminaux.
 */
export function nextStatus(current: IncidentStatus, e: Evidence, p: IncidentParams): IncidentStatus {
  if (current === 'RESOLU' || current === 'EXPIRE') return current;
  const score = computeScore(e, p);
  if (e.contestations >= p['incident.minContestationsToReject'] && score <= p['incident.rejectScore']) return 'EXPIRE';
  if (current === 'DETECTE' && computeConfidence(score, p) >= p['incident.confirmThreshold']) return 'CONFIRME';
  return current;
}
