export type Pt = [number, number]; // [lon, lat]
const R = 6371000, rad = Math.PI / 180;

export function haversine(a: Pt, b: Pt): number {
  const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Distance (m) d'un point à une polyligne, projection équirectangulaire locale par segment. */
export function distanceToPolyline(p: Pt, line: Pt[]): number {
  let best = Infinity;
  const kx = Math.cos(p[1] * rad);
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const ax = a[0] * kx, ay = a[1], bx = b[0] * kx, by = b[1], px = p[0] * kx, py = p[1];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    best = Math.min(best, haversine(p, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]));
  }
  return best;
}

export function samplePoints(line: Pt[], n: number): Pt[] {
  if (line.length <= n) return line;
  return Array.from({ length: n }, (_, i) => line[Math.round((i * (line.length - 1)) / (n - 1))]);
}

/** Part des points échantillonnés de `reference` situés à moins de `tol` mètres de `candidate`. */
export function overlapFraction(reference: Pt[], candidate: Pt[], tol: number, samples = 60): number {
  const pts = samplePoints(reference, samples);
  if (!pts.length || candidate.length < 2) return 0;
  return pts.filter((p) => distanceToPolyline(p, candidate) <= tol).length / pts.length;
}

/** Empreinte stable d'un itinéraire (coordonnées arrondies, échantillonnées). */
export function routeHash(line: Pt[]): string {
  const { createHash } = require('crypto');
  const s = samplePoints(line, 12).map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join(';');
  return createHash('sha1').update(s).digest('hex').slice(0, 16);
}
