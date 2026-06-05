/**
 * Offline liveness via challenge–response.
 *
 * From face-api's 68 landmarks + expression scores we derive simple, robust
 * metrics (Eye/Mouth Aspect Ratio, a yaw proxy, smile probability). A short
 * randomized sequence of challenges (blink / smile / open mouth / turn head)
 * defeats static photo & screen attacks because a printed or replayed image
 * cannot perform an unpredictable action on demand.
 */
import { CONFIG } from '../config';
import { Challenge, ChallengeType, FaceMetrics } from '../types';
import { LivenessFace } from './faceEngine';

interface Pt {
  x: number;
  y: number;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Eye Aspect Ratio for a 6-point eye (p0..p5). */
function eyeAspectRatio(eye: Pt[]): number {
  const a = dist(eye[1], eye[5]);
  const b = dist(eye[2], eye[4]);
  const c = dist(eye[0], eye[3]);
  return c === 0 ? 0 : (a + b) / (2 * c);
}

/** Mouth Aspect Ratio using the 20-point mouth (outer + inner) landmarks. */
function mouthAspectRatio(mouth: Pt[]): number {
  // Inner mouth opening (points 13..19 in face-api's mouth array are the inner lip).
  const top = mouth[14];
  const bottom = mouth[18];
  const left = mouth[12];
  const right = mouth[16];
  const vertical = dist(top, bottom);
  const horizontal = dist(left, right);
  return horizontal === 0 ? 0 : vertical / horizontal;
}

function centroid(pts: Pt[]): Pt {
  const s = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / pts.length, y: s.y / pts.length };
}

/**
 * Normalised horizontal yaw proxy from 68-pt landmarks: horizontal offset of the
 * nose tip from the eye-midpoint, divided by inter-ocular distance. ~0 looking
 * forward, grows (and flips sign) as the head turns left/right. Shared by the
 * liveness loop and guided enrollment so both read head pose the same way.
 */
export function yawFromLandmarks(lm: any): number {
  const leftEyeC = centroid(lm.getLeftEye() as Pt[]);
  const rightEyeC = centroid(lm.getRightEye() as Pt[]);
  const eyeMid = { x: (leftEyeC.x + rightEyeC.x) / 2, y: (leftEyeC.y + rightEyeC.y) / 2 };
  // getNose() returns 9 points (dlib 27..35); index 3 is point 30, the nose tip.
  const nose = lm.getNose() as Pt[];
  const noseTip = nose[3] ?? nose[nose.length - 1];
  const iod = dist(leftEyeC, rightEyeC) || 1;
  return (noseTip.x - eyeMid.x) / iod;
}

/**
 * Compute per-frame face metrics. Returns null when no usable face is present.
 */
export function computeMetrics(face: LivenessFace | undefined): FaceMetrics | null {
  if (!face) return null;
  const lm = face.landmarks;
  const leftEye = lm.getLeftEye() as Pt[];
  const rightEye = lm.getRightEye() as Pt[];
  const mouth = lm.getMouth() as Pt[];

  const ear = (eyeAspectRatio(leftEye) + eyeAspectRatio(rightEye)) / 2;
  const mar = mouthAspectRatio(mouth);
  const yaw = yawFromLandmarks(lm);

  const expr = face.expressions as unknown as { happy: number };
  const box = face.detection.box;

  return {
    ear,
    mar,
    smile: expr?.happy ?? 0,
    yaw,
    score: face.detection.score,
    box: [box.x, box.y, box.width, box.height],
  };
}

export const ALL_CHALLENGES: Record<ChallengeType, Challenge> = {
  blink: { type: 'blink', label: 'Blink', instruction: 'Blink your eyes' },
  smile: { type: 'smile', label: 'Smile', instruction: 'Give a big smile' },
  mouthOpen: { type: 'mouthOpen', label: 'Open mouth', instruction: 'Open your mouth wide' },
  turnHead: { type: 'turnHead', label: 'Turn head', instruction: 'Slowly turn your head to one side' },
};

/**
 * Pick `count` distinct random challenges. `seed` keeps it deterministic-free
 * but stable within one verification attempt (caller passes Date-based value
 * via Math.random — fine on-device).
 */
export function pickChallenges(count = CONFIG.livenessChallengeCount): Challenge[] {
  const pool = Object.values(ALL_CHALLENGES);
  // Fisher–Yates shuffle.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

/**
 * Stateful evaluator for a single challenge across a stream of frames.
 * `blink` and `turnHead` need a transition, so we track progress between frames.
 */
export class ChallengeEvaluator {
  private sawEyesOpen = false;
  private sawForward = false;

  constructor(public readonly challenge: Challenge) {}

  /** Feed one frame's metrics. Returns true once the challenge is satisfied. */
  update(m: FaceMetrics): boolean {
    switch (this.challenge.type) {
      case 'smile':
        return m.smile >= CONFIG.smileThreshold;

      case 'mouthOpen':
        return m.mar >= CONFIG.marOpen;

      case 'blink':
        // Require an open->closed transition to avoid passing on a closed-eye photo.
        if (m.ear >= CONFIG.earOpen) this.sawEyesOpen = true;
        return this.sawEyesOpen && m.ear <= CONFIG.earClosed;

      case 'turnHead':
        // Require a forward pose first, then a clear turn.
        if (Math.abs(m.yaw) < CONFIG.yawTurnThreshold * 0.5) this.sawForward = true;
        return this.sawForward && Math.abs(m.yaw) >= CONFIG.yawTurnThreshold;

      default:
        return false;
    }
  }

  reset() {
    this.sawEyesOpen = false;
    this.sawForward = false;
  }
}
