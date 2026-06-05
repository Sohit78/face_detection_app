/**
 * Central configuration for the NHAI offline face-auth prototype.
 * Tunable thresholds live here so they can be adjusted without touching logic.
 */

export const CONFIG = {
  // ---- Recognition ----
  /** face-api descriptors are compared with Euclidean distance. Lower = stricter. */
  recognitionThreshold: 0.55,
  /** Max capture attempts during the recognition phase. A clear face matches on
   * the first frame; extra attempts only cover momentary blur/no-face. */
  recognitionMaxAttempts: 3,

  // ---- Enrollment (guided 3-pose capture: front / left / right) ----
  /** Max |yaw| proxy to accept a "front" capture (must be near-frontal). */
  enrollFrontYawMax: 0.06,
  /** Min |yaw| proxy to accept a "left"/"right" capture (must be a real, moderate turn). */
  enrollTurnYawMin: 0.08,

  // ---- Liveness (challenge–response) ----
  /** Number of randomized challenges the user must pass to be considered "live". */
  livenessChallengeCount: 2,
  /** "Get ready" countdown (seconds) shown before each challenge's capture loop
   * so the user can read the instruction and get into the pose. */
  readyCountdownSec: 3,
  /** Per-challenge timeout in milliseconds before it is marked failed. */
  challengeTimeoutMs: 12000,
  /** Eye Aspect Ratio thresholds for blink detection. Keep a clear gap between
   * open and closed so a single noisy frame can't satisfy both states. */
  earOpen: 0.25,
  earClosed: 0.19,
  /** Mouth Aspect Ratio threshold for "open mouth". 0.5 was too strict at low
   * detector resolution; 0.35 still clearly separates open from closed. */
  marOpen: 0.35,
  /** Minimum happy-expression probability to count as a smile. */
  smileThreshold: 0.5,
  /** Normalised yaw proxy magnitude required for a "turn head" challenge. */
  yawTurnThreshold: 0.16,

  // ---- Camera / performance ----
  /** Longest edge (px) the captured frame is resized to before inference (CPU speed). */
  inferenceMaxSize: 256,
  /** Detector input size (multiple of 32). Smaller = faster, less accurate. */
  detectorInputSize: 160,
  /** Detector confidence threshold. */
  detectorScoreThreshold: 0.5,
  /** Delay between auto-captured frames during the liveness loop. The inference
   * itself already takes ~300ms/frame, so this only adds a small breather; keep
   * it short so the loop samples many frames and feels responsive. */
  captureIntervalMs: 150,
  /** JPEG quality for captured frames (lower = faster decode). */
  captureQuality: 0.5,

  // ---- Sync & purge ----
  /**
   * AWS / backend endpoint that accepts the attendance + enrollment payload.
   * Replace with the real Datalake 3.0 sync URL. When empty, the app falls back
   * to "simulate" mode so the offline→online sync/purge flow can still be demoed.
   */
  syncEndpoint: '',
  /** Optional bearer token for the sync endpoint. */
  syncApiKey: '',
  /** Network timeout (ms) for a sync attempt. */
  syncTimeoutMs: 10000,
} as const;
