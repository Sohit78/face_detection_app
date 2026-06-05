/** Shared domain types for the offline face-auth prototype. */

export interface Person {
  id: number;
  name: string;
  employeeId: string | null;
  createdAt: number;
  synced: boolean;
}

/** A stored face template (128-d descriptor) belonging to a person. */
export interface FaceTemplate {
  id: number;
  personId: number;
  name: string;
  employeeId: string | null;
  descriptor: Float32Array;
}

export interface AttendanceRecord {
  id: number;
  personId: number | null;
  name: string;
  employeeId: string | null;
  ts: number;
  livenessPassed: boolean;
  /** Recognition distance (lower = closer match). */
  score: number;
  synced: boolean;
}

/** Per-frame facial metrics derived from landmarks + expressions. */
export interface FaceMetrics {
  /** Eye Aspect Ratio (average of both eyes). */
  ear: number;
  /** Mouth Aspect Ratio. */
  mar: number;
  /** Happy-expression probability (0..1). */
  smile: number;
  /** Normalised horizontal yaw proxy (~0 looking forward, +/- when turned). */
  yaw: number;
  /** Detection confidence (0..1). */
  score: number;
  /** Detected face box in the (resized) frame: [x, y, w, h]. */
  box: [number, number, number, number];
}

export type ChallengeType = 'blink' | 'smile' | 'mouthOpen' | 'turnHead';

export interface Challenge {
  type: ChallengeType;
  label: string;
  instruction: string;
}

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';
