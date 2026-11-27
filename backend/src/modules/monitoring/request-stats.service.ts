import { Injectable } from '@nestjs/common';

/** Fenêtre glissante de 5 minutes (compteurs par minute) : requêtes, erreurs 5xx, p95 des durées. */
@Injectable()
export class RequestStatsService {
  private buckets = new Map<number, { n: number; err: number; durations: number[] }>();
  constructor(private now: () => number = Date.now) {}

  record(durationMs: number, status: number) {
    const minute = Math.floor(this.now() / 60_000);
    const b = this.buckets.get(minute) ?? { n: 0, err: 0, durations: [] };
    b.n++;
    if (status >= 500) b.err++;
    if (b.durations.length < 2000) b.durations.push(durationMs);
    this.buckets.set(minute, b);
    for (const k of this.buckets.keys()) if (k < minute - 6) this.buckets.delete(k);
  }

  window(minutes = 5) {
    const minute = Math.floor(this.now() / 60_000);
    let n = 0, err = 0;
    const all: number[] = [];
    for (const [k, b] of this.buckets) if (k > minute - minutes) { n += b.n; err += b.err; all.push(...b.durations); }
    all.sort((a, b) => a - b);
    return { requests: n, errors5xx: err, p95Ms: all.length ? all[Math.min(all.length - 1, Math.ceil(all.length * 0.95) - 1)] : null };
  }
}
