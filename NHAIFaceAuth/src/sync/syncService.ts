/**
 * Offline -> online sync & purge.
 *
 * When connectivity returns, pending attendance is uploaded to the configured
 * AWS / Datalake endpoint and the synced rows are purged locally (the
 * hackathon's "local data to be purged" requirement).
 *
 * Because the prototype ships without a live backend, `syncNow()` supports a
 * `simulate` mode that performs the exact same mark-synced + purge flow without
 * a network call, so the end-to-end mechanism is demoable offline. Point
 * CONFIG.syncEndpoint at the real server to switch to live uploads.
 */
import { CONFIG } from '../config';
import {
  getUnsyncedAttendance,
  markAttendanceSynced,
  purgeSyncedAttendance,
} from '../db/database';

export interface SyncResult {
  attempted: number;
  uploaded: number;
  purged: number;
  mode: 'live' | 'simulated' | 'noop';
  ok: boolean;
  message: string;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function syncNow(simulate = false): Promise<SyncResult> {
  const pending = await getUnsyncedAttendance();
  if (pending.length === 0) {
    return { attempted: 0, uploaded: 0, purged: 0, mode: 'noop', ok: true, message: 'Nothing to sync.' };
  }

  const ids = pending.map((p) => p.id);
  const useLive = !simulate && !!CONFIG.syncEndpoint;

  if (useLive) {
    try {
      const res = await fetchWithTimeout(
        CONFIG.syncEndpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(CONFIG.syncApiKey ? { Authorization: `Bearer ${CONFIG.syncApiKey}` } : {}),
          },
          body: JSON.stringify({
            source: 'NHAIFaceAuth',
            attendance: pending.map((p) => ({
              clientId: p.id,
              personId: p.personId,
              name: p.name,
              employeeId: p.employeeId,
              timestamp: p.ts,
              livenessPassed: p.livenessPassed,
              matchScore: p.score,
            })),
          }),
        },
        CONFIG.syncTimeoutMs,
      );
      if (!res.ok) {
        return {
          attempted: ids.length,
          uploaded: 0,
          purged: 0,
          mode: 'live',
          ok: false,
          message: `Server responded ${res.status}. Records kept for retry.`,
        };
      }
      await markAttendanceSynced(ids);
      const purged = await purgeSyncedAttendance();
      return {
        attempted: ids.length,
        uploaded: ids.length,
        purged,
        mode: 'live',
        ok: true,
        message: `Uploaded ${ids.length} record(s) and purged local copies.`,
      };
    } catch (e: any) {
      return {
        attempted: ids.length,
        uploaded: 0,
        purged: 0,
        mode: 'live',
        ok: false,
        message: `Offline or unreachable (${e?.message ?? 'network error'}). Records kept.`,
      };
    }
  }

  // Simulated path: identical mark-synced + purge, no network.
  await markAttendanceSynced(ids);
  const purged = await purgeSyncedAttendance();
  return {
    attempted: ids.length,
    uploaded: ids.length,
    purged,
    mode: 'simulated',
    ok: true,
    message: `Simulated upload of ${ids.length} record(s) and purged local copies.`,
  };
}
