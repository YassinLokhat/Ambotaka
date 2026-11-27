import { NAV_MAX_ACCURACY_M, FIX_MAX_AGE_MS } from './constants';
import { RouteStep } from './types';

type Pt = [number, number]; // [lon, lat]
const R = 6371000;
const rad = Math.PI / 180;

export function haversine(a: Pt, b: Pt): number {
  const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface Projection { distanceToRouteM: number; progressM: number; totalM: number }

/** Projette un point sur la polyligne (approximation équirectangulaire locale par segment). */
export function projectOnRoute(coords: Pt[], p: Pt): Projection {
  let best = Infinity, bestProgress = 0, cum = 0;
  const kx = Math.cos(p[1] * rad);
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i], b = coords[i + 1];
    const segLen = haversine(a, b);
    const ax = a[0] * kx, ay = a[1], bx = b[0] * kx, by = b[1], px = p[0] * kx, py = p[1];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const proj: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const d = haversine(p, proj);
    if (d < best) { best = d; bestProgress = cum + segLen * t; }
    cum += segLen;
  }
  return { distanceToRouteM: best, progressM: bestProgress, totalM: cum };
}

export interface Fix { lat: number; lon: number; accuracy: number | null; timestamp: number }

/** NAV-003 / NAV-011 : une position imprécise ou obsolète n'alimente jamais le guidage. */
export function isFixReliable(fix: Fix, now: number): boolean {
  return fix.accuracy !== null && fix.accuracy <= NAV_MAX_ACCURACY_M && now - fix.timestamp <= FIX_MAX_AGE_MS;
}

export interface Guidance {
  remainingMeters: number; remainingSeconds: number; offRouteMeters: number;
  nextStep: RouteStep | null; distanceToNextStepMeters: number | null;
}

export function computeGuidance(
  coords: Pt[], steps: RouteStep[], routeDistanceM: number, routeDurationS: number, p: Pt,
): Guidance {
  const proj = projectOnRoute(coords, p);
  const remaining = Math.max(0, proj.totalM - proj.progressM);
  let next: RouteStep | null = null, dist: number | null = null;
  for (const st of steps) {
    const sp = projectOnRoute(coords, st.location).progressM;
    if (sp > proj.progressM + 5) { next = st; dist = sp - proj.progressM; break; }
  }
  const ratio = routeDistanceM > 0 ? remaining / routeDistanceM : 0;
  return {
    remainingMeters: remaining, remainingSeconds: Math.round(routeDurationS * ratio),
    offRouteMeters: proj.distanceToRouteM, nextStep: next, distanceToNextStepMeters: dist,
  };
}

/** Partie de l'itinéraire encore à parcourir depuis `p`, réduite à `maxPoints` points (début et fin conservés). */
export function remainingCoordinates(coords: Pt[], p: Pt, maxPoints = 300): Pt[] {
  if (coords.length < 2) return coords;
  let bestI = 0, bestD = Infinity, bestPt: Pt = coords[0];
  const kx = Math.cos(p[1] * rad);
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i], b = coords[i + 1];
    const ax = a[0] * kx, ay = a[1], dx = b[0] * kx - ax, dy = b[1] - ay, len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] * kx - ax) * dx + (p[1] - ay) * dy) / len2));
    const q: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const d = haversine(p, q);
    if (d < bestD) { bestD = d; bestI = i; bestPt = q; }
  }
  const rest: Pt[] = [bestPt, ...coords.slice(bestI + 1)];
  if (rest.length <= maxPoints) return rest;
  return Array.from({ length: maxPoints }, (_, k) => rest[Math.round((k * (rest.length - 1)) / (maxPoints - 1))]);
}
