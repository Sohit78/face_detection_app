import React, { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useApp } from '../AppContext';
import { Button, Card, IconChip, Screen } from '../components/ui';
import { FaceCamera, FaceCameraHandle } from '../components/FaceCamera';
import { CONFIG } from '../config';
import { enrollPerson } from '../db/database';
import { analyzeForRecognition } from '../ml/faceEngine';
import { yawFromLandmarks } from '../ml/liveness';
import { uriToTensor } from '../ml/image';
import { RootStackParamList } from '../navigation';
import { colors, font, radius, shadow, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Enroll'>;

type Step = 'form' | 'capture' | 'saving' | 'done';
type Flash = 'idle' | 'active' | 'success' | 'error';
type PoseKey = 'front' | 'left' | 'right';

/** The three guided poses, captured one descriptor per tap, in this order. */
const POSES: { key: PoseKey; label: string; instruction: string }[] = [
  { key: 'front', label: 'Front', instruction: 'Look straight at the camera' },
  { key: 'left', label: 'Left', instruction: 'Turn your head slightly to your LEFT' },
  { key: 'right', label: 'Right', instruction: 'Turn your head slightly to your RIGHT' },
];

/**
 * Accept a capture only if the head pose roughly matches the requested one.
 * The sign of the yaw proxy is intentionally NOT checked: the front camera frame
 * may be mirrored, so we verify only that "front" is near-frontal and a turn is a
 * real turn. Thresholds live in CONFIG and can be tuned after on-device testing.
 */
function poseYawOk(pose: PoseKey, yaw: number): boolean {
  const a = Math.abs(yaw);
  return pose === 'front' ? a <= CONFIG.enrollFrontYawMax : a >= CONFIG.enrollTurnYawMin;
}

export default function EnrollScreen({ navigation }: Props) {
  const { refreshStats, refreshTemplates } = useApp();
  const cameraRef = useRef<FaceCameraHandle>(null);
  const busyRef = useRef(false);
  const descriptorsRef = useRef<Float32Array[]>([]);

  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [poseIdx, setPoseIdx] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [hint, setHint] = useState('');
  const [flash, setFlash] = useState<Flash>('active');
  const [processing, setProcessing] = useState(false);
  const [formError, setFormError] = useState('');

  const pose = POSES[poseIdx];

  /** Capture + analyze a single frame for the current pose. */
  async function captureCurrentPose() {
    if (busyRef.current || step !== 'capture') return;
    busyRef.current = true;
    setProcessing(true);
    setFlash('active');
    let tensor: any;
    try {
      const uri = await cameraRef.current?.capture();
      if (!uri) {
        setHint('Camera not ready…');
        return;
      }
      tensor = await uriToTensor(uri);
      const res = await analyzeForRecognition(tensor);
      if (!res) {
        setHint('No face detected — center your face');
        setFlash('error');
        return;
      }
      if (res.detection.score < 0.5) {
        setHint('Hold steady — face not clear');
        setFlash('error');
        return;
      }
      if (res.detection.relativeBox.width < 0.12) {
        setHint('Move a little closer');
        setFlash('error');
        return;
      }
      const yaw = yawFromLandmarks(res.landmarks);
      if (!poseYawOk(pose.key, yaw)) {
        setHint(
          pose.key === 'front'
            ? 'Look straight at the camera'
            : `Turn your head a bit more to your ${pose.label.toLowerCase()}`,
        );
        setFlash('error');
        console.log('[EnrollScreen] Pose rejected:', pose.key, 'yaw', yaw.toFixed(3));
        return;
      }

      // Good capture for this pose — store its descriptor.
      descriptorsRef.current.push(Float32Array.from(res.descriptor));
      setFlash('success');
      console.log(`[EnrollScreen] Captured pose ${pose.key} (${descriptorsRef.current.length}/${POSES.length})`);

      const next = poseIdx + 1;
      if (next >= POSES.length) {
        setHint('All poses captured ✓');
        await save();
      } else {
        setPoseIdx(next);
        setHint(`Captured ${pose.label} ✓ — next: ${POSES[next].instruction}`);
      }
    } catch (e: any) {
      console.error('[EnrollScreen] Capture error:', e);
      setHint(`Error: ${String(e?.message ?? e).slice(0, 80)}`);
      setFlash('error');
    } finally {
      tensor?.dispose?.();
      busyRef.current = false;
      setProcessing(false);
    }
  }

  async function save() {
    setStep('saving');
    console.log('[EnrollScreen] Saving enrollment - Name:', name, 'Employee ID:', employeeId, 'Poses:', descriptorsRef.current.length);
    try {
      await enrollPerson(name.trim(), employeeId.trim() || null, descriptorsRef.current, Date.now());
      console.log('[EnrollScreen] Enrollment saved successfully');
      await refreshStats();
      await refreshTemplates();
      setStep('done');
    } catch (e) {
      console.error('[EnrollScreen] Save failed:', e);
      setFormError(`Save failed: ${String(e)}`);
      setStep('form');
    }
  }

  function startCapture() {
    if (!name.trim()) {
      console.warn('[EnrollScreen] Start capture failed - no name provided');
      setFormError('Please enter a name first');
      return;
    }
    console.log('[EnrollScreen] Starting guided capture - Name:', name, 'Employee ID:', employeeId);
    setFormError('');
    descriptorsRef.current = [];
    setPoseIdx(0);
    setCameraReady(false);
    setHint(POSES[0].instruction);
    setFlash('active');
    setStep('capture');
  }

  function cancelCapture() {
    console.log('[EnrollScreen] Capture cancelled');
    descriptorsRef.current = [];
    setStep('form');
  }

  // ----- Form -----
  if (step === 'form') {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Screen>
          <Card>
            <View style={styles.formHead}>
              <IconChip glyph="🧑‍💼" tone="blue" size={48} />
              <View style={{ flex: 1 }}>
                <Text style={styles.formTitle}>Personnel details</Text>
                <Text style={styles.formTitleSub}>Enter the person's identity before capture</Text>
              </View>
            </View>
            <Text style={styles.label}>Full name *</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Ramesh Kumar"
              placeholderTextColor={colors.textFaint}
            />
            <Text style={[styles.label, { marginTop: spacing.md }]}>Employee ID</Text>
            <TextInput
              style={styles.input}
              value={employeeId}
              onChangeText={setEmployeeId}
              placeholder="e.g. NHAI-10293"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="characters"
            />
          </Card>

          <Card style={{ marginTop: spacing.md, backgroundColor: colors.surfaceAlt }} elevated={false}>
            <View style={styles.poseGuideRow}>
              {POSES.map((p) => (
                <View key={p.key} style={styles.poseGuideItem}>
                  <Text style={styles.poseGuideGlyph}>
                    {p.key === 'front' ? '😐' : p.key === 'left' ? '😏' : '🙂'}
                  </Text>
                  <Text style={styles.poseGuideLabel}>{p.label}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.help}>
              We'll capture {POSES.length} guided face poses on-device. Keep your face inside the oval
              in good lighting and tap to take each photo.
            </Text>
          </Card>

          {!!formError && <Text style={styles.error}>{formError}</Text>}
          <Button title="Start face capture" icon="📷" onPress={startCapture} style={{ marginTop: spacing.lg }} />
        </Screen>
      </KeyboardAvoidingView>
    );
  }

  // ----- Done -----
  if (step === 'done') {
    return (
      <View style={[styles.container, styles.center]}>
        <View style={[styles.successCard, shadow('lg')]}>
          <View style={styles.successBadge}>
            <Text style={styles.successTick}>✓</Text>
          </View>
          <Text style={styles.successTitle}>Enrolled successfully</Text>
          <Text style={styles.successName}>{name.trim()}</Text>
          <Text style={styles.muted}>
            {employeeId.trim() ? `${employeeId.trim()} · ` : ''}
            {POSES.length} poses saved on-device
          </Text>
        </View>
        <View style={styles.doneActions}>
          <Button title="Done" icon="✓" onPress={() => navigation.goBack()} />
          <Button
            title="Enroll another"
            variant="ghost"
            onPress={() => {
              setName('');
              setEmployeeId('');
              setPoseIdx(0);
              setHint('');
              setStep('form');
            }}
          />
        </View>
      </View>
    );
  }

  // ----- Capture / saving -----
  const saving = step === 'saving';
  return (
    <View style={styles.cameraWrap}>
      <FaceCamera
        ref={cameraRef}
        instruction={saving ? 'Saving…' : `${poseIdx + 1}/${POSES.length} · ${pose.instruction}`}
        hint={saving ? 'Please wait' : hint}
        state={saving ? 'success' : flash}
        busy={processing}
        onReady={() => setCameraReady(true)}
      />
      <View style={styles.cameraFooter}>
        <View style={styles.poseRow}>
          {POSES.map((p, i) => {
            const isDone = saving || i < poseIdx;
            const isCurrent = !saving && i === poseIdx;
            return (
              <View
                key={p.key}
                style={[
                  styles.poseChip,
                  isDone && styles.poseChipDone,
                  isCurrent && styles.poseChipCurrent,
                ]}
              >
                <Text
                  style={[
                    styles.poseChipText,
                    isCurrent && styles.poseChipTextCurrent,
                    isDone && styles.poseChipTextDone,
                  ]}
                >
                  {isDone ? '✓ ' : ''}
                  {p.label}
                </Text>
              </View>
            );
          })}
        </View>
        <Button
          title={processing ? 'Analyzing…' : saving ? 'Saving…' : `Capture ${pose.label.toLowerCase()}`}
          onPress={captureCurrentPose}
          disabled={saving || processing || !cameraReady}
        />
        <Button title="Cancel" variant="secondary" onPress={cancelCapture} disabled={saving} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  formHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  formTitle: { fontSize: font.h3, fontWeight: '800', color: colors.text },
  formTitleSub: { fontSize: font.small, color: colors.textMuted, marginTop: 1 },
  label: { fontSize: font.small, fontWeight: '700', color: colors.textMuted, marginBottom: spacing.xs },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: font.body,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
  },
  poseGuideRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: spacing.sm },
  poseGuideItem: { alignItems: 'center', gap: spacing.xs },
  poseGuideGlyph: { fontSize: 30 },
  poseGuideLabel: { fontSize: font.small, fontWeight: '700', color: colors.textMuted },
  help: { fontSize: font.small, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 19 },
  error: { fontSize: font.body, color: colors.danger, marginTop: spacing.md, fontWeight: '600' },

  cameraWrap: { flex: 1, padding: spacing.md, backgroundColor: colors.bg },
  cameraFooter: { paddingTop: spacing.md, gap: spacing.sm },
  poseRow: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' },
  poseChip: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  poseChipCurrent: { borderColor: colors.accent, borderWidth: 2, backgroundColor: colors.tintGreen },
  poseChipDone: { borderColor: colors.success, backgroundColor: colors.success },
  poseChipText: { fontSize: font.small, fontWeight: '700', color: colors.textMuted },
  poseChipTextCurrent: { color: colors.accentDark },
  poseChipTextDone: { color: colors.white },

  successCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: colors.border,
  },
  successBadge: {
    width: 84,
    height: 84,
    borderRadius: 999,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  successTick: { color: colors.white, fontSize: 48, fontWeight: '800' },
  successTitle: { fontSize: font.h2, fontWeight: '800', color: colors.text },
  successName: { fontSize: font.h3, fontWeight: '700', color: colors.primary, marginTop: spacing.xs },
  muted: { fontSize: font.body, color: colors.textMuted, marginTop: spacing.xs, textAlign: 'center' },
  doneActions: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.lg },
});
