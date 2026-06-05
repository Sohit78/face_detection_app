/**
 * Front-camera view with an oval face guide and an imperative `capture()` that
 * returns the photo's file uri. Screens drive the capture cadence (e.g. a
 * liveness loop) and feed the uri into the face engine.
 */
import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { CONFIG } from '../config';
import { colors, font, radius, spacing } from '../theme';
import { Button } from './ui';

export interface FaceCameraHandle {
  /** Capture a still and return its local file uri (or null on failure). */
  capture: () => Promise<string | null>;
  /** Whether the camera hardware has reported ready. */
  isReady: () => boolean;
}

interface Props {
  /** Large instruction shown inside the frame (e.g. the current challenge). */
  instruction?: string;
  /** Smaller helper line under the oval. */
  hint?: string;
  /** Oval border tone for feedback. */
  state?: 'idle' | 'active' | 'success' | 'error';
  /** Show an "analyzing" spinner while a frame is being processed. */
  busy?: boolean;
  /** Fired once the camera hardware is ready to capture. */
  onReady?: () => void;
}

export const FaceCamera = forwardRef<FaceCameraHandle, Props>(function FaceCamera(
  { instruction, hint, state = 'idle', busy, onReady },
  ref,
) {
  const cameraRef = useRef<CameraView>(null);
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  useImperativeHandle(ref, () => ({
    async capture() {
      if (!cameraRef.current || !readyRef.current) {
        console.warn('[FaceCamera] Capture called but camera not ready');
        return null;
      }
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: CONFIG.captureQuality,
          exif: false,
        });
        console.log('[FaceCamera] Photo captured - URI:', photo?.uri);
        return photo?.uri ?? null;
      } catch (e) {
        console.error('[FaceCamera] Capture failed:', e);
        return null;
      }
    },
    isReady() {
      return readyRef.current;
    },
  }));

  if (!permission) {
    return <View style={styles.fill} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.fill, styles.permission]}>
        <Text style={styles.permTitle}>Camera access needed</Text>
        <Text style={styles.permBody}>
          Face authentication runs entirely on this device. No images leave the phone.
        </Text>
        <Button title="Grant camera access" onPress={requestPermission} />
      </View>
    );
  }

  const ovalColor =
    state === 'success'
      ? colors.success
      : state === 'error'
        ? colors.danger
        : state === 'active'
          ? colors.accent
          : 'rgba(255,255,255,0.85)';

  return (
    <View style={styles.fill}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="front"
        animateShutter={false}
        onCameraReady={() => {
          console.log('[FaceCamera] Camera hardware ready');
          readyRef.current = true;
          setReady(true);
          onReady?.();
        }}
      />
      <View style={styles.overlay} pointerEvents="none">
        {!!instruction && (
          <View style={styles.instructionWrap}>
            <Text style={styles.instruction}>{instruction}</Text>
          </View>
        )}
        <View style={[styles.oval, { borderColor: ovalColor }]}>
          {busy && <ActivityIndicator color={colors.white} size="large" />}
        </View>
        {!ready && (
          <View style={styles.badge}>
            <ActivityIndicator color={colors.white} />
            <Text style={styles.badgeText}>Starting camera…</Text>
          </View>
        )}
        {!!hint && ready && <Text style={styles.hint}>{hint}</Text>}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000', overflow: 'hidden', borderRadius: radius.lg },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  oval: {
    width: '70%',
    aspectRatio: 0.78,
    borderRadius: 999,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  instructionWrap: {
    position: 'absolute',
    top: spacing.lg,
    backgroundColor: colors.overlay,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  instruction: { color: colors.white, fontSize: font.h3, fontWeight: '700', textAlign: 'center' },
  badge: {
    position: 'absolute',
    bottom: spacing.xl,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.overlay,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  badgeText: { color: colors.white, fontSize: font.body },
  hint: {
    position: 'absolute',
    bottom: spacing.xl,
    color: colors.white,
    fontSize: font.body,
    textAlign: 'center',
    backgroundColor: colors.overlay,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  permission: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  permTitle: { fontSize: font.h2, fontWeight: '700', color: colors.white },
  permBody: { fontSize: font.body, color: '#CBD5E1', textAlign: 'center', marginBottom: spacing.md },
});
