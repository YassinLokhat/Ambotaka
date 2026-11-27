import * as SQLite from 'expo-sqlite';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** Base locale unique (spec §11.1) : sessions, résumés, réglages, file d'observations. */
export function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('roadpulse.db').then(async (d) => {
      await d.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS navigation_sessions (
          id TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_sessions_status ON navigation_sessions(status);
        CREATE TABLE IF NOT EXISTS trip_summaries (
          id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER,
          final_status TEXT NOT NULL, distance_m INTEGER, effective_duration_s INTEGER,
          retain_until INTEGER, acknowledged INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS deletion_requests (
          id TEXT PRIMARY KEY NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, types TEXT NOT NULL,
          status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL, confirmed_at INTEGER, server_id TEXT, last_error TEXT,
          blocked_notified INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS report_queue (
          client_report_id TEXT PRIMARY KEY NOT NULL, type TEXT NOT NULL, description TEXT,
          lat REAL NOT NULL, lon REAL NOT NULL, observed_at INTEGER NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS observation_queue (
          client_obs_id TEXT PRIMARY KEY NOT NULL, observed_at INTEGER NOT NULL,
          lat REAL NOT NULL, lon REAL NOT NULL, accuracy REAL NOT NULL, speed_mps REAL NOT NULL, heading REAL);
      `);
      return d;
    });
  }
  return dbPromise;
}
