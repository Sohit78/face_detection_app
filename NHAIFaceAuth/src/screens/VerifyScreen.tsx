import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useApp } from '../AppContext';
import { Button, Card, IconChip, Screen } from '../components/ui';
import { FaceCamera, FaceCameraHandle } from '../components/FaceCamera';
import { CONFIG } from '../config';
import { logAttendance } from '../db/database';
import { analyzeForLiveness, analyzeForRecognition } from '../ml/faceEngine';
import { uriToTensor } from '../ml/image';
import { ChallengeEvaluator, computeMetrics, pickChallenges } from '../ml/liveness';
import { matchDescriptor, MatchResult } from '../ml/recognition';
import { Challenge } from '../types';
import { RootStackParamList } from '../navigation';
import { colors, font, radius, shadow, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Verify'>;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Phase = 'intro' | 'liveness' | 'recognizing' | 'result';
type Outcome =
  | { kind: 'success'; match: MatchResult; ts: number }
  | { kind: 'liveness_failed' }
  | { kind: 'not_recognized' }
  | null;

export default function VerifyScreen({ navigation }: Props) {
  const { templates, refreshStats } = useApp();
  const cameraRef = useRef<FaceCameraHandle>(null);
  const runningRef = useRef(false);
  const loopStartedRef = useRef(false);
  const processingRef = useRef(false);

  const [phase, setPhase] = useState<Phase>('intro');
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [challengeIdx, setChallengeIdx] = useState(0);
  const [hint, setHint] = useState('');
  const [processing, setProcessing] = useState(false);
  const [flash, setFlash] = useState<'idle' | 'active' | 'success' | 'error'>('active');
  const [outcome, setOutcome] = useState<Outcome>(null);
  /** Seconds remaining in the "get ready" countdown before a challenge starts (0 = not counting). */
  const [countdown, setCountdown] = useState(0);
  /** Countdown for initial wait period before verification starts (5 seconds) */
  const [waitCountdown, setWaitCountdown] = useState(0);

  useEffect(() => {
    return () => {
      runningRef.current = false;
      processingRef.current = false; // stop loop when leaving screen
    };
  }, []);

  async function grabMetrics() {
    setProcessing(true);
    let tensor: any;
    try {
      const uri = await cameraRef.current?.capture();
      if (!uri) return null;
      tensor = await uriToTensor(uri);
      const res = await analyzeForLiveness(tensor);
      return computeMetrics(res);
    } catch (e: any) {
      console.error('[VerifyScreen] Liveness metrics error:', e);
      setHint(`Error: ${String(e?.message ?? e).slice(0, 80)}`);
      return null;
    } finally {
      tensor?.dispose?.();
      setProcessing(false);
    }
  }

  /**
   * Show a "get ready" countdown so the user can position themselves into the
   * upcoming pose before the detection loop starts. Returns false if the screen
   * was cancelled mid-countdown.
   */
  async function getReady(chal: Challenge, seconds = CONFIG.readyCountdownSec): Promise<boolean> {
    for (let s = seconds; s > 0; s--) {
      if (!runningRef.current) return false;
      setCountdown(s);
      setHint(`Get ready to ${chal.instruction.toLowerCase()} — ${s}…`);
      await delay(1000);
    }
    setCountdown(0);
    return runningRef.current;
  }

  async function runLiveness() {
    try {
      // Wait for countdown to finish
      while (waitCountdown > 0 && runningRef.current) {
        await delay(100);
      }
      
      if (!runningRef.current) return;

      const chals = pickChallenges();
      setChallenges(chals);
      console.log('[VerifyScreen] Starting liveness challenges:', chals.map(c => c.type).join(', '));

      for (let i = 0; i < chals.length; i++) {
        if (!runningRef.current) return;
        setChallengeIdx(i);
        setFlash('active');

        // Give the user time to read the instruction and get into the pose.
        if (!(await getReady(chals[i]))) return;

        const evaluator = new ChallengeEvaluator(chals[i]);
        const deadline = Date.now() + CONFIG.challengeTimeoutMs;
        let passed = false;

        console.log(`[VerifyScreen] Challenge ${i + 1}/${chals.length}: ${chals[i].type}`);
        let frames = 0;
        while (runningRef.current && Date.now() < deadline) {
          frames++;
          const m = await grabMetrics();
          if (!m) {
            setHint('Center your face in the oval');
          } else if (m.score < 0.5) {
            setHint('Hold still — detecting face');
          } else {
            setHint(challengeHint(chals[i]));
            console.log(
              `[VerifyScreen] ${chals[i].type} metrics — ear:${m.ear.toFixed(2)} mar:${m.mar.toFixed(2)} smile:${m.smile.toFixed(2)} yaw:${m.yaw.toFixed(2)}`,
            );
            if (evaluator.update(m)) {
              passed = true;
              console.log(`[VerifyScreen] Challenge ${i + 1} passed: ${chals[i].type}`);
              break;
            }
          }
          await delay(CONFIG.captureIntervalMs);
        }

        if (!passed) {
          console.warn(
            `[VerifyScreen] Challenge ${i + 1} failed: ${chals[i].type} after ${frames} frames, running=${runningRef.current}, timedOut=${Date.now() >= deadline}`,
          );
          finish({ kind: 'liveness_failed' }, 'error');
          return;
        }
        setFlash('success');
        await delay(450);
      }

      if (runningRef.current) {
        console.log('[VerifyScreen] All liveness challenges passed, starting recognition');
        runRecognition();
      }
    } finally {
      processingRef.current = false;
    }
  }

  async function runRecognition() {
    try {
      setPhase('recognizing');
      setHint('Verifying identity…');
      console.log('[VerifyScreen] Starting recognition with', templates.length, 'enrolled templates');
      let match: MatchResult | null = null;

      for (let attempt = 0; attempt < CONFIG.recognitionMaxAttempts && runningRef.current; attempt++) {
        setProcessing(true);
        let tensor: any;
        let frameOk = false;
        try {
          const tA = Date.now();
          const uri = await cameraRef.current?.capture();
          if (uri) {
            tensor = await uriToTensor(uri);
            const res = await analyzeForRecognition(tensor);
            console.log('[VerifyScreen] Recognition attempt', attempt + 1, 'took', Date.now() - tA, 'ms');
            if (res && res.detection.score >= 0.5) {
              frameOk = true;
              const candidate = matchDescriptor(Float32Array.from(res.descriptor), templates);
              if (candidate) {
                console.log('[VerifyScreen] Match found:', candidate.name, 'Distance:', candidate.distance);
                match = candidate;
                break;
              }
              console.log('[VerifyScreen] No match found for this descriptor');
              setHint('Face seen — checking against records…');
            } else {
              console.warn('[VerifyScreen] Detection score too low or no face');
              setHint('Center your face in the oval');
            }
          }
        } catch (e: any) {
          console.error('[VerifyScreen] Recognition error:', e);
          setHint(`Error: ${String(e?.message ?? e).slice(0, 80)}`);
        } finally {
          tensor?.dispose?.();
          setProcessing(false);
        }
        // Only pause before a retry when the frame was unusable (no face / blurry)
        // — a clear face that simply didn't match won't improve by waiting, and a
        // good capture path shouldn't pay any inter-attempt delay at all.
        if (!frameOk && runningRef.current) await delay(CONFIG.captureIntervalMs);
      }

      if (!runningRef.current) return;

      if (match) {
        const ts = Date.now();
        console.log('[VerifyScreen] Recording attendance for:', match.name, 'Score:', match.distance);
        try {
          await logAttendance({
            personId: match.personId,
            name: match.name,
            employeeId: match.employeeId,
            ts,
            livenessPassed: true,
            score: match.distance,
          });
          console.log('[VerifyScreen] Attendance logged successfully');
          await refreshStats();
        } catch (e) {
          console.error('[VerifyScreen] Attendance logging failed:', e);
          /* still show success; record best-effort */
        }
        finish({ kind: 'success', match, ts }, 'success');
      } else {
        console.warn('[VerifyScreen] No match found after all attempts');
        finish({ kind: 'not_recognized' }, 'error');
      }
    } finally {
      processingRef.current = false;
    }
  }

  function finish(o: Outcome, f: 'success' | 'error') {
    console.log('[VerifyScreen] Verification finished -', f === 'success' ? 'SUCCESS' : 'FAILED', '-', o?.kind);
    runningRef.current = false;
    processingRef.current = false;
    loopStartedRef.current = false;
    setCountdown(0);
    setWaitCountdown(0);
    setOutcome(o);
    setFlash(f);
    setPhase('result');
  }

  function onCameraReady() {
    if (phase === 'liveness' && runningRef.current && !loopStartedRef.current && !processingRef.current) {
      loopStartedRef.current = true;
      processingRef.current = true;
      runLiveness();
    }
  }

  function begin() {
    if (templates.length === 0) return;
    if (runningRef.current || processingRef.current) {
      console.log('[VerifyScreen] Verification already in progress, ignoring duplicate begin() call');
      return;
    }
    
    setOutcome(null);
    loopStartedRef.current = false;
    runningRef.current = true;
    setPhase('liveness');
    
    // Show 5-second wait countdown before starting verification
    setHint('Get ready for verification...');
    let countdown = 5;
    const countdownInterval = setInterval(async () => {
      if (!runningRef.current) {
        clearInterval(countdownInterval);
        return;
      }
      countdown--;
      if (countdown > 0) {
        setWaitCountdown(countdown);
        setHint(`Starting verification in ${countdown} second${countdown === 1 ? '' : 's'}...`);
      } else {
        clearInterval(countdownInterval);
        setWaitCountdown(0);
        setHint('Center your face in the oval');
        // After countdown completes, verification will start via onCameraReady
      }
    }, 1000);
  }

  // ---------------- Intro ----------------
  if (phase === 'intro') {
    const noEnroll = templates.length === 0;
    return (
      <Screen>
        <Card>
          <View style={styles.introHead}>
            <IconChip glyph="🛡️" tone="green" size={52} />
            <Text style={styles.title}>Liveness + face check</Text>
          </View>
          <Text style={styles.body}>
            You'll be asked to perform {CONFIG.livenessChallengeCount} quick actions to prove you're
            real, then your face is matched against enrolled personnel — all on-device.
          </Text>
          <View style={styles.stepsList}>
            {[
              { g: '👁️', t: 'Perform live actions', s: 'Blink, smile or open your mouth on cue' },
              { g: '🧠', t: 'Match identity', s: 'Compared to enrolled face templates' },
              { g: '✓', t: 'Mark attendance', s: 'Logged on-device, synced later' },
            ].map((row, i) => (
              <View key={i} style={styles.stepItem}>
                <IconChip glyph={row.g} tone="blue" size={38} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepTitle}>{row.t}</Text>
                  <Text style={styles.stepSub}>{row.s}</Text>
                </View>
              </View>
            ))}
          </View>
        </Card>
        {noEnroll ? (
          <Card style={{ marginTop: spacing.md, borderColor: colors.warning }}>
            <Text style={[styles.body, { color: colors.warning }]}>
              No personnel enrolled yet. Enroll at least one person first.
            </Text>
            <Button
              title="Go to Enroll"
              variant="secondary"
              onPress={() => navigation.navigate('Enroll')}
              style={{ marginTop: spacing.md }}
            />
          </Card>
        ) : (
          <Button title="Begin verification" icon="▶" onPress={begin} style={{ marginTop: spacing.lg }} />
        )}
      </Screen>
    );
  }

  // ---------------- Result ----------------
  if (phase === 'result') {
    return <ResultView outcome={outcome} onRetry={begin} onHome={() => navigation.goBack()} />;
  }

  // ---------------- Live camera (liveness / recognizing) ----------------
  const stepLabel =
    phase === 'recognizing'
      ? 'Verifying identity…'
      : countdown > 0
        ? `Get ready… ${countdown}`
        : `Step ${challengeIdx + 1}/${challenges.length}: ${challenges[challengeIdx]?.instruction ?? ''}`;

  return (
    <View style={styles.cameraWrap}>
      <FaceCamera
        ref={cameraRef}
        instruction={stepLabel}
        hint={hint}
        state={flash}
        busy={processing && countdown === 0}
        onReady={onCameraReady}
      />
      <View style={styles.cameraFooter}>
        {phase === 'liveness' && challenges.length > 0 && (
          <View style={styles.progressRow}>
            {challenges.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.progressDot,
                  i < challengeIdx && styles.progressDotDone,
                  i === challengeIdx && styles.progressDotActive,
                ]}
              />
            ))}
          </View>
        )}
        <Button
          title="Cancel"
          variant="secondary"
          onPress={() => {
            runningRef.current = false;
            processingRef.current = false;
            navigation.goBack();
          }}
        />
      </View>
    </View>
  );
}

function challengeHint(c: Challenge): string {
  switch (c.type) {
    case 'blink':
      return 'Look at the camera, then blink';
    case 'smile':
      return 'Smile 😊';
    case 'mouthOpen':
      return 'Open your mouth wide';
    case 'turnHead':
      return 'Turn your head to one side';
    default:
      return '';
  }
}

function ResultView({
  outcome,
  onRetry,
  onHome,
}: {
  outcome: Outcome;
  onRetry: () => void;
  onHome: () => void;
}) {
  const success = outcome?.kind === 'success';
  return (
    <View style={[styles.container, styles.center]}>
      <View style={[styles.resultCard, shadow('lg')]}>
        <View
          style={[styles.resultBadge, { backgroundColor: success ? colors.success : colors.danger }]}
        >
          <Text style={styles.resultIcon}>{success ? '✓' : '✕'}</Text>
        </View>

        {outcome?.kind === 'success' && (
          <>
            <Text style={styles.resultTitle}>Attendance marked</Text>
            <Text style={styles.resultName}>{outcome.match.name}</Text>
            {!!outcome.match.employeeId && (
              <Text style={styles.muted}>{outcome.match.employeeId}</Text>
            )}
            <View style={styles.confBar}>
              <View
                style={[
                  styles.confFill,
                  { width: `${Math.min(100, Math.round(outcome.match.confidence * 100))}%` },
                ]}
              />
            </View>
            <Text style={styles.muted}>
              {new Date(outcome.ts).toLocaleString()} · {(outcome.match.confidence * 100).toFixed(0)}%
              confidence
            </Text>
          </>
        )}
        {outcome?.kind === 'liveness_failed' && (
          <>
            <Text style={styles.resultTitle}>Liveness check failed</Text>
            <Text style={styles.muted}>
              Couldn't confirm a live person. Avoid photos/screens and try again in good lighting.
            </Text>
          </>
        )}
        {outcome?.kind === 'not_recognized' && (
          <>
            <Text style={styles.resultTitle}>Face not recognized</Text>
            <Text style={styles.muted}>
              Liveness passed but no enrolled match was found. Try again or enroll this person.
            </Text>
          </>
        )}
      </View>

      <View style={styles.resultActions}>
        <Button title="Try again" icon="↻" onPress={onRetry} />
        <Button title="Back to home" variant="ghost" onPress={onHome} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: font.h2, fontWeight: '800', color: colors.text, flex: 1 },
  body: { fontSize: font.body, color: colors.textMuted, lineHeight: 21 },

  introHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  stepsList: { marginTop: spacing.lg, gap: spacing.md },
  stepItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepTitle: { fontSize: font.body, fontWeight: '700', color: colors.text },
  stepSub: { fontSize: font.small, color: colors.textMuted, marginTop: 1 },

  cameraWrap: { flex: 1, padding: spacing.md, backgroundColor: colors.bg },
  cameraFooter: { paddingTop: spacing.md, gap: spacing.md },
  progressRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm },
  progressDot: {
    width: 28,
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.borderStrong,
  },
  progressDotActive: { backgroundColor: colors.primary, width: 36 },
  progressDotDone: { backgroundColor: colors.success },

  resultCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: colors.border,
  },
  resultBadge: {
    width: 88,
    height: 88,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  resultIcon: { color: colors.white, fontSize: 52, fontWeight: '800' },
  resultTitle: { fontSize: font.h2, fontWeight: '800', color: colors.text, marginBottom: spacing.xs },
  resultName: { fontSize: font.h2, fontWeight: '800', color: colors.primary, marginTop: spacing.xs },
  muted: { fontSize: font.body, color: colors.textMuted, marginTop: spacing.xs, textAlign: 'center' },
  confBar: {
    height: 8,
    width: '70%',
    borderRadius: 999,
    backgroundColor: colors.bgDeep,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  confFill: { height: '100%', borderRadius: 999, backgroundColor: colors.success },
  resultActions: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.lg },
});
