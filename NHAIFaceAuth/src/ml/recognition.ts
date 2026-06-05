/**
 * Face recognition matching utilities (pure math, fully offline).
 *
 * face-api's FaceRecognitionNet produces a 128-d descriptor. Identity is decided
 * by Euclidean distance against enrolled templates (the standard face-api metric;
 * < ~0.6 is "same person"). We keep every enrolled sample per person and match
 * against the closest one, which is more robust than averaging.
 */
import { CONFIG } from '../config';
import { FaceTemplate } from '../types';

export function euclidean(a: Float32Array | number[], b: Float32Array | number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export interface MatchResult {
  personId: number;
  name: string;
  employeeId: string | null;
  distance: number;
  /** Convenience confidence in 0..1 (1 = identical). */
  confidence: number;
}

/**
 * Find the best matching person for a probe descriptor.
 * Returns null when no template is within the recognition threshold.
 */
export function matchDescriptor(
  probe: Float32Array,
  templates: FaceTemplate[],
  threshold = CONFIG.recognitionThreshold,
): MatchResult | null {
  console.log('[Recognition] Matching descriptor against', templates.length, 'templates (threshold:', threshold.toFixed(2), ')');
  let best: MatchResult | null = null;
  for (const t of templates) {
    const distance = euclidean(probe, t.descriptor);
    if (!best || distance < best.distance) {
      best = {
        personId: t.personId,
        name: t.name,
        employeeId: t.employeeId,
        distance,
        confidence: Math.max(0, 1 - distance),
      };
    }
  }
  if (!best || best.distance > threshold) {
    console.warn('[Recognition] No match found', best ? `(best was ${best.name} with distance ${best.distance.toFixed(3)})` : '');
    return null;
  }
  console.log('[Recognition] Match found:', best.name, 'Distance:', best.distance.toFixed(3), 'Confidence:', best.confidence.toFixed(3));
  return best;
}

/** Serialise a descriptor for SQLite storage. */
export function serializeDescriptor(d: Float32Array): string {
  return JSON.stringify(Array.from(d));
}

export function deserializeDescriptor(s: string): Float32Array {
  return Float32Array.from(JSON.parse(s) as number[]);
}
