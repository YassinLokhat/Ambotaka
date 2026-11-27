import { getDb } from '../../core/database';
import { IncidentType } from '../../core/api';

export interface QueuedReport {
  clientReportId: string; type: IncidentType; description: string | null; lat: number; lon: number;
  observedAt: number; attempts: number; nextAttemptAt: number;
}

export async function enqueueReport(r: { clientReportId: string; type: IncidentType; description?: string; lat: number; lon: number; observedAt: number }) {
  const now = Date.now();
  await (await getDb()).runAsync(
    `INSERT OR IGNORE INTO report_queue (client_report_id, type, description, lat, lon, observed_at, next_attempt_at, created_at)
     VALUES (?,?,?,?,?,?,?,?)`, r.clientReportId, r.type, r.description ?? null, r.lat, r.lon, r.observedAt, now, now);
}

const map = (x: any): QueuedReport => ({
  clientReportId: x.client_report_id, type: x.type, description: x.description, lat: x.lat, lon: x.lon,
  observedAt: x.observed_at, attempts: x.attempts, nextAttemptAt: x.next_attempt_at,
});

export async function listDueReports(now: number): Promise<QueuedReport[]> {
  return (await (await getDb()).getAllAsync('SELECT * FROM report_queue WHERE next_attempt_at <= ? ORDER BY observed_at', now)).map(map);
}
export async function countReports(): Promise<number> {
  return (await (await getDb()).getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM report_queue'))?.n ?? 0;
}
export async function deleteReport(id: string) {
  await (await getDb()).runAsync('DELETE FROM report_queue WHERE client_report_id=?', id);
}
export async function clearReports() {
  await (await getDb()).runAsync('DELETE FROM report_queue');
}
export async function markReportFailed(id: string, attempts: number, nextAttemptAt: number) {
  await (await getDb()).runAsync('UPDATE report_queue SET attempts=?, next_attempt_at=? WHERE client_report_id=?', attempts, nextAttemptAt, id);
}
