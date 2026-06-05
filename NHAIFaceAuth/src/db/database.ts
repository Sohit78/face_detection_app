/**
 * Offline-first local store (expo-sqlite, SDK 56 async API).
 *
 * Holds enrolled persons, their face templates (128-d descriptors), and
 * attendance events. Everything lives on-device so recognition works with no
 * network. The sync layer (see src/sync) uploads pending rows and then purges
 * them per the "sync & purge" requirement.
 */
import * as SQLite from 'expo-sqlite';

import { AttendanceRecord, FaceTemplate, Person } from '../types';
import { deserializeDescriptor, serializeDescriptor } from '../ml/recognition';

let _db: SQLite.SQLiteDatabase | null = null;
let _initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Open the DB and create the schema. Idempotent and safe to call concurrently:
 * the first call does the work and every other (earlier or later) caller awaits
 * the same promise. Every accessor below funnels through this, so a query issued
 * before init has finished — e.g. a screen's focus effect on cold start — waits
 * for the DB instead of throwing.
 */
async function ensureDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  if (!_initPromise) {
    _initPromise = (async () => {
      console.log('[Database] Opening database connection...');
      const database = await SQLite.openDatabaseAsync('nhai_faceauth.db');
      console.log('[Database] Creating schema...');
      await database.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS persons (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          name         TEXT NOT NULL,
          employee_id  TEXT,
          created_at   INTEGER NOT NULL,
          synced       INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS templates (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          person_id   INTEGER NOT NULL,
          descriptor  TEXT NOT NULL,
          created_at  INTEGER NOT NULL,
          FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS attendance (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          person_id    INTEGER,
          name         TEXT NOT NULL,
          employee_id  TEXT,
          ts           INTEGER NOT NULL,
          liveness     INTEGER NOT NULL DEFAULT 0,
          score        REAL NOT NULL DEFAULT 0,
          synced       INTEGER NOT NULL DEFAULT 0
        );
      `);
      _db = database;
      console.log('[Database] Database initialized successfully');
      return database;
    })().catch((e) => {
      _initPromise = null; // allow a later retry after a failed init
      throw e;
    });
  }
  return _initPromise;
}

/** Explicit init hook for app start. Optional now — every accessor self-inits. */
export async function initDb(): Promise<void> {
  await ensureDb();
}

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

/** Create a person and store one descriptor per captured sample. */
export async function enrollPerson(
  name: string,
  employeeId: string | null,
  descriptors: Float32Array[],
  createdAt: number,
): Promise<number> {
  console.log('[Database] Enrolling person:', name, 'Employee ID:', employeeId, 'Descriptors:', descriptors.length);
  const d = await ensureDb();
  const res = await d.runAsync(
    'INSERT INTO persons (name, employee_id, created_at, synced) VALUES (?, ?, ?, 0)',
    name,
    employeeId,
    createdAt,
  );
  const personId = res.lastInsertRowId;
  console.log('[Database] Person created with ID:', personId);
  for (const desc of descriptors) {
    await d.runAsync(
      'INSERT INTO templates (person_id, descriptor, created_at) VALUES (?, ?, ?)',
      personId,
      serializeDescriptor(desc),
      createdAt,
    );
  }
  console.log('[Database] Enrollment complete - ID:', personId);
  return personId;
}

interface TemplateRow {
  id: number;
  person_id: number;
  descriptor: string;
  name: string;
  employee_id: string | null;
}

/** Load every enrolled template (joined with its person) for matching. */
export async function getAllTemplates(): Promise<FaceTemplate[]> {
  const rows = await (await ensureDb()).getAllAsync<TemplateRow>(
    `SELECT t.id, t.person_id, t.descriptor, p.name, p.employee_id
     FROM templates t JOIN persons p ON p.id = t.person_id`,
  );
  const result = rows.map((r) => ({
    id: r.id,
    personId: r.person_id,
    name: r.name,
    employeeId: r.employee_id,
    descriptor: deserializeDescriptor(r.descriptor),
  }));
  console.log('[Database] getAllTemplates returned', result.length, 'templates');
  return result;
}

interface PersonRow {
  id: number;
  name: string;
  employee_id: string | null;
  created_at: number;
  synced: number;
  samples: number;
}

export async function getPersons(): Promise<(Person & { samples: number })[]> {
  const rows = await (await ensureDb()).getAllAsync<PersonRow>(
    `SELECT p.*, (SELECT COUNT(*) FROM templates t WHERE t.person_id = p.id) AS samples
     FROM persons p ORDER BY p.created_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    employeeId: r.employee_id,
    createdAt: r.created_at,
    synced: !!r.synced,
    samples: r.samples,
  }));
}

export async function deletePerson(id: number): Promise<void> {
  await (await ensureDb()).runAsync('DELETE FROM persons WHERE id = ?', id);
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export async function logAttendance(rec: {
  personId: number | null;
  name: string;
  employeeId: string | null;
  ts: number;
  livenessPassed: boolean;
  score: number;
}): Promise<number> {
  console.log('[Database] Logging attendance - Name:', rec.name, 'Score:', rec.score, 'Liveness:', rec.livenessPassed);
  const res = await (await ensureDb()).runAsync(
    `INSERT INTO attendance (person_id, name, employee_id, ts, liveness, score, synced)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    rec.personId,
    rec.name,
    rec.employeeId,
    rec.ts,
    rec.livenessPassed ? 1 : 0,
    rec.score,
  );
  console.log('[Database] Attendance logged with ID:', res.lastInsertRowId);
  return res.lastInsertRowId;
}

interface AttendanceRow {
  id: number;
  person_id: number | null;
  name: string;
  employee_id: string | null;
  ts: number;
  liveness: number;
  score: number;
  synced: number;
}

function mapAttendance(r: AttendanceRow): AttendanceRecord {
  return {
    id: r.id,
    personId: r.person_id,
    name: r.name,
    employeeId: r.employee_id,
    ts: r.ts,
    livenessPassed: !!r.liveness,
    score: r.score,
    synced: !!r.synced,
  };
}

export async function getAttendance(limit = 100): Promise<AttendanceRecord[]> {
  const rows = await (await ensureDb()).getAllAsync<AttendanceRow>(
    'SELECT * FROM attendance ORDER BY ts DESC LIMIT ?',
    limit,
  );
  return rows.map(mapAttendance);
}

export async function getUnsyncedAttendance(): Promise<AttendanceRecord[]> {
  const rows = await (await ensureDb()).getAllAsync<AttendanceRow>(
    'SELECT * FROM attendance WHERE synced = 0 ORDER BY ts ASC',
  );
  return rows.map(mapAttendance);
}

export async function markAttendanceSynced(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const placeholders = ids.map(() => '?').join(',');
  await (await ensureDb()).runAsync(`UPDATE attendance SET synced = 1 WHERE id IN (${placeholders})`, ...ids);
}

/** Delete attendance rows that have been synced (the "purge" half of sync&purge). */
export async function purgeSyncedAttendance(): Promise<number> {
  const res = await (await ensureDb()).runAsync('DELETE FROM attendance WHERE synced = 1');
  return res.changes;
}

// ---------------------------------------------------------------------------
// Stats & reset
// ---------------------------------------------------------------------------

export async function getStats(): Promise<{
  persons: number;
  pendingAttendance: number;
  totalAttendance: number;
}> {
  const d = await ensureDb();
  const persons = await d.getFirstAsync<{ c: number }>('SELECT COUNT(*) AS c FROM persons');
  const pending = await d.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) AS c FROM attendance WHERE synced = 0',
  );
  const total = await d.getFirstAsync<{ c: number }>('SELECT COUNT(*) AS c FROM attendance');
  const stats = {
    persons: persons?.c ?? 0,
    pendingAttendance: pending?.c ?? 0,
    totalAttendance: total?.c ?? 0,
  };
  console.log('[Database] Stats:', stats);
  return stats;
}

/** Wipe all local data (factory reset / full purge). */
export async function resetAll(): Promise<void> {
  console.log('[Database] Resetting all data...');
  await (await ensureDb()).execAsync('DELETE FROM attendance; DELETE FROM templates; DELETE FROM persons;');
  console.log('[Database] Reset complete');
}
