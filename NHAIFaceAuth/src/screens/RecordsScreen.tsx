import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useApp } from '../AppContext';
import { Button, Card, Pill } from '../components/ui';
import { CONFIG } from '../config';
import { getAttendance, getPersons, resetAll } from '../db/database';
import { syncNow, SyncResult } from '../sync/syncService';
import { AttendanceRecord, Person } from '../types';
import { RootStackParamList } from '../navigation';
import { colors, font, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Records'>;

export default function RecordsScreen(_props: Props) {
  const { refreshStats, refreshTemplates } = useApp();
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [persons, setPersons] = useState<(Person & { samples: number })[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);

  const load = useCallback(async () => {
    setAttendance(await getAttendance());
    setPersons(await getPersons());
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function doSync() {
    setSyncing(true);
    try {
      const res = await syncNow();
      setLastSync(res);
      await load();
      await refreshStats();
    } finally {
      setSyncing(false);
    }
  }

  function confirmReset() {
    Alert.alert(
      'Factory reset',
      'Delete ALL enrolled personnel, face templates and attendance from this device? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: async () => {
            await resetAll();
            await load();
            await refreshStats();
            await refreshTemplates();
            setLastSync(null);
          },
        },
      ],
    );
  }

  const pending = attendance.filter((a) => !a.synced).length;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card>
        <Text style={styles.cardTitle}>Sync & purge</Text>
        <Text style={styles.muted}>
          {CONFIG.syncEndpoint
            ? `Endpoint configured. Pending records upload to the server, then local copies are purged.`
            : `No server endpoint set — running in simulate mode. The same upload-then-purge flow runs locally so it can be demonstrated offline. Set CONFIG.syncEndpoint for live AWS sync.`}
        </Text>
        <View style={styles.syncRow}>
          <Pill
            text={`${pending} pending`}
            tone={pending > 0 ? 'warning' : 'success'}
          />
          <Pill text={CONFIG.syncEndpoint ? 'Live mode' : 'Simulate mode'} tone="neutral" />
        </View>
        {lastSync && (
          <Text style={[styles.muted, { color: lastSync.ok ? colors.success : colors.danger }]}>
            {lastSync.message} {lastSync.mode !== 'noop' ? `(${lastSync.mode})` : ''}
          </Text>
        )}
        <Button
          title={pending > 0 ? `Sync & purge ${pending} record(s)` : 'Nothing to sync'}
          onPress={doSync}
          loading={syncing}
          disabled={pending === 0}
          style={{ marginTop: spacing.md }}
        />
      </Card>

      <Card style={{ marginTop: spacing.md }}>
        <Text style={styles.cardTitle}>Enrolled personnel ({persons.length})</Text>
        {persons.length === 0 && <Text style={styles.muted}>No one enrolled yet.</Text>}
        {persons.map((p) => (
          <View key={p.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{p.name}</Text>
              <Text style={styles.rowSub}>
                {p.employeeId ? `${p.employeeId} · ` : ''}
                {p.samples} sample(s)
              </Text>
            </View>
            <Pill text={p.synced ? 'synced' : 'local'} tone={p.synced ? 'success' : 'neutral'} />
          </View>
        ))}
      </Card>

      <Card style={{ marginTop: spacing.md }}>
        <Text style={styles.cardTitle}>Recent attendance</Text>
        {attendance.length === 0 && <Text style={styles.muted}>No attendance recorded yet.</Text>}
        {attendance.map((a) => (
          <View key={a.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{a.name}</Text>
              <Text style={styles.rowSub}>
                {new Date(a.ts).toLocaleString()} · {a.livenessPassed ? 'live ✓' : 'no liveness'}
              </Text>
            </View>
            <Pill text={a.synced ? 'synced' : 'pending'} tone={a.synced ? 'success' : 'warning'} />
          </View>
        ))}
      </Card>

      <Button
        title="Factory reset (purge all local data)"
        variant="danger"
        onPress={confirmReset}
        style={{ marginTop: spacing.lg }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing.xl },
  cardTitle: { fontSize: font.h3, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  muted: { fontSize: font.small, color: colors.textMuted, lineHeight: 19, marginTop: spacing.xs },
  syncRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rowTitle: { fontSize: font.body, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
});
