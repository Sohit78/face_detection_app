import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useApp } from '../AppContext';
import { ActionTile, Button, Card, Hero, Pill, Screen, SectionTitle, StatTile } from '../components/ui';
import { RootStackParamList } from '../navigation';
import { colors, font, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export default function HomeScreen({ navigation }: Props) {
  const { engineStatus, engineError, stats, refreshStats, retryInit } = useApp();

  useFocusEffect(
    useCallback(() => {
      console.log('[HomeScreen] Screen focused');
      refreshStats();
    }, [refreshStats]),
  );

  const ready = engineStatus === 'ready';

  return (
    <Screen>
      <Hero title="NHAI Face Auth" subtitle="On-device recognition + liveness for field personnel. Works fully offline." glyph="🛣️">
        <View style={styles.heroStatus}>
          {engineStatus === 'loading' && <Pill text="Loading models…" tone="warning" dot />}
          {engineStatus === 'ready' && <Pill text="Ready · Offline" tone="success" dot />}
          {engineStatus === 'error' && <Pill text="Engine error" tone="danger" dot />}
          {engineStatus === 'idle' && <Pill text="Starting…" tone="neutral" dot />}
        </View>
      </Hero>

      {engineStatus === 'loading' && (
        <Card style={{ marginBottom: spacing.lg }}>
          <Text style={styles.muted}>
            Loading the face models from on-device storage (first launch only)…
          </Text>
        </Card>
      )}
      {engineStatus === 'error' && (
        <Card style={{ marginBottom: spacing.lg, borderColor: colors.danger }}>
          <Text style={[styles.muted, { color: colors.danger, marginBottom: spacing.sm }]}>{engineError}</Text>
          <Button title="Retry initialization" variant="secondary" icon="↻" onPress={retryInit} />
        </Card>
      )}

      <SectionTitle>On-device data</SectionTitle>
      <View style={styles.statRow}>
        <StatTile glyph="👥" value={stats.persons} label="Enrolled" tone="blue" />
        <StatTile glyph="🕓" value={stats.pendingAttendance} label="Pending sync" tone="amber" />
        <StatTile glyph="✓" value={stats.totalAttendance} label="Total marks" tone="green" />
      </View>

      <View style={{ height: spacing.lg }} />
      <SectionTitle>Actions</SectionTitle>
      <View style={{ gap: spacing.md }}>
        <ActionTile
          glyph="✓"
          tone="green"
          title="Mark Attendance"
          subtitle="Liveness check + face match"
          disabled={!ready}
          onPress={() => {
            console.log('[HomeScreen] Navigating to Verify (Mark Attendance)');
            navigation.navigate('Verify');
          }}
        />
        <ActionTile
          glyph="＋"
          tone="blue"
          title="Enroll Personnel"
          subtitle="Capture 3 guided face poses"
          disabled={!ready}
          onPress={() => {
            console.log('[HomeScreen] Navigating to Enroll');
            navigation.navigate('Enroll');
          }}
        />
        <ActionTile
          glyph="☁"
          tone="amber"
          title="Records & Sync"
          subtitle="Review logs · upload · purge"
          onPress={() => {
            console.log('[HomeScreen] Navigating to Records');
            navigation.navigate('Records');
          }}
        />
      </View>

      <View style={styles.footerWrap}>
        <Text style={styles.footerLock}>🔒</Text>
        <Text style={styles.footer}>
          Models bundled on-device · No images or biometrics leave the phone.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroStatus: { flexDirection: 'row', marginTop: spacing.md },
  muted: { fontSize: font.small, color: colors.textMuted, lineHeight: 19 },
  statRow: { flexDirection: 'row', gap: spacing.sm },
  footerWrap: { marginTop: spacing.xl, alignItems: 'center', gap: spacing.xs },
  footerLock: { fontSize: 16 },
  footer: { fontSize: font.small, color: colors.textMuted, textAlign: 'center', lineHeight: 18 },
});
