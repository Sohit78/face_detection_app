/**
 * App-wide initialisation + shared state.
 *
 * On mount we: open the local DB, then load the face models from bundled
 * weights. The engine status drives the UI (loading / ready / error with retry).
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { initDb, getStats } from './db/database';
import { initFaceEngine, getEngineStatus } from './ml/faceEngine';
import { getAllTemplates } from './db/database';
import { FaceTemplate, EngineStatus } from './types';

interface AppState {
  engineStatus: EngineStatus;
  engineError: string | null;
  dbReady: boolean;
  stats: { persons: number; pendingAttendance: number; totalAttendance: number };
  templates: FaceTemplate[];
  refreshStats: () => Promise<void>;
  refreshTemplates: () => Promise<void>;
  retryInit: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used within <AppProvider>');
  return v;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('idle');
  const [engineError, setEngineError] = useState<string | null>(null);
  const [dbReady, setDbReady] = useState(false);
  const [stats, setStats] = useState({ persons: 0, pendingAttendance: 0, totalAttendance: 0 });
  const [templates, setTemplates] = useState<FaceTemplate[]>([]);
  const [initToken, setInitToken] = useState(0);

  const refreshStats = useCallback(async () => {
    try {
      const stats = await getStats();
      console.log('[AppContext] Stats refreshed:', stats);
      setStats(stats);
    } catch (e) {
      console.warn('[AppContext] Stats refresh failed:', e);
      /* db may not be ready yet */
    }
  }, []);

  const refreshTemplates = useCallback(async () => {
    try {
      const templates = await getAllTemplates();
      console.log('[AppContext] Templates refreshed:', templates.length, 'templates loaded');
      setTemplates(templates);
    } catch (e) {
      console.warn('[AppContext] Templates refresh failed:', e);
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      console.log('[AppContext] Initialization starting...');
      // 1) Local store first (cheap, lets the rest of the app function).
      try {
        console.log('[AppContext] Initializing database...');
        await initDb();
        if (cancelled) return;
        console.log('[AppContext] Database initialized successfully');
        setDbReady(true);
        await refreshStats();
        await refreshTemplates();
      } catch (e) {
        // DB failure is rare; surface via engine error channel.
        console.error('[AppContext] Database initialization failed:', e);
        if (!cancelled) setEngineError(`Storage init failed: ${String(e)}`);
      }

      // 2) Face models (heavier — a few seconds on first launch).
      console.log('[AppContext] Loading face models...');
      setEngineStatus('loading');
      try {
        await initFaceEngine();
        if (!cancelled) {
          console.log('[AppContext] Face models loaded successfully');
          setEngineStatus('ready');
          setEngineError(null);
        }
      } catch (e: any) {
        console.error('[AppContext] Face model loading failed:', e);
        if (!cancelled) {
          setEngineStatus('error');
          setEngineError(e?.message ?? getEngineStatus().error ?? 'Failed to load models');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initToken, refreshStats, refreshTemplates]);

  const retryInit = useCallback(() => setInitToken((t) => t + 1), []);

  return (
    <Ctx.Provider
      value={{
        engineStatus,
        engineError,
        dbReady,
        stats,
        templates,
        refreshStats,
        refreshTemplates,
        retryInit,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
