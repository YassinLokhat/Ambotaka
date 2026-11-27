import { AppParams } from '../../shared/parameters/parameters.service';

export type TrafficState = 'FLUIDE' | 'RALENTI' | 'CONGESTIONNE' | 'INCONNU';

/** Écart angulaire minimal entre deux caps, en degrés [0,180]. */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Sens par rapport à la géométrie : 1 = dans le sens du tracé, -1 = inverse. */
export function directionFor(heading: number | null | undefined, segmentAzimuth: number): 1 | -1 | 0 {
  if (heading === null || heading === undefined) return 0;
  return angleDiff(heading, segmentAzimuth) <= 90 ? 1 : -1;
}

/** Jamais de « fluide » sans vitesse de référence : on retourne INCONNU (NFR-014). */
export function classify(meanKph: number, freeFlowKph: number | null, p: AppParams): TrafficState {
  if (!freeFlowKph || freeFlowKph <= 0) return 'INCONNU';
  const ratio = meanKph / freeFlowKph;
  if (ratio >= p['traffic.fluidRatio']) return 'FLUIDE';
  if (ratio >= p['traffic.slowRatio']) return 'RALENTI';
  return 'CONGESTIONNE';
}

export function trafficConfidence(contributors: number, samples: number, p: AppParams): number {
  const c = Math.min(1, contributors / p['traffic.fullContributors']);
  const s = Math.min(1, samples / p['traffic.fullSamples']);
  return Math.round((0.6 * c + 0.4 * s) * 100) / 100;
}
