/** Reusable UI primitives styled with the app theme (gov-modern look). */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, font, gradients, radius, shadow, spacing } from '../theme';

type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: string;
  style?: ViewStyle;
}) {
  const isDisabled = disabled || loading;
  const fg =
    variant === 'secondary' || variant === 'ghost' ? colors.primary : colors.white;

  const content = loading ? (
    <ActivityIndicator color={fg} />
  ) : (
    <View style={styles.btnInner}>
      {!!icon && <Text style={[styles.btnIcon, { color: fg }]}>{icon}</Text>}
      <Text style={[styles.btnText, { color: fg }]}>{title}</Text>
    </View>
  );

  // Gradient-filled variants get a richer look; flat variants use a solid bg.
  const gradient =
    variant === 'primary' ? gradients.hero : variant === 'accent' ? gradients.accent : null;
  const solidBg =
    variant === 'danger'
      ? colors.danger
      : variant === 'secondary'
        ? colors.surface
        : 'transparent';

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.btnWrap,
        variant !== 'ghost' && variant !== 'secondary' && shadow('sm'),
        { opacity: isDisabled ? 0.5 : pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] },
        style,
      ]}
    >
      {gradient ? (
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.btn}
        >
          {content}
        </LinearGradient>
      ) : (
        <View style={[styles.btn, { backgroundColor: solidBg }, variant === 'secondary' && styles.btnBordered]}>
          {content}
        </View>
      )}
    </Pressable>
  );
}

/** Consistent screen scroll container with safe-area-aware padding. */
export function Screen({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={[
        { padding: spacing.lg, paddingBottom: spacing.xl + insets.bottom },
        style,
      ]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

/** Gradient hero banner with a title, subtitle and optional status pill row. */
export function Hero({
  title,
  subtitle,
  glyph,
  children,
}: {
  title: string;
  subtitle?: string;
  glyph?: string;
  children?: React.ReactNode;
}) {
  return (
    <LinearGradient
      colors={gradients.hero}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.hero, shadow('md')]}
    >
      <View style={styles.heroTop}>
        {!!glyph && (
          <View style={styles.heroGlyphWrap}>
            <Text style={styles.heroGlyph}>{glyph}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.heroTitle}>{title}</Text>
          {!!subtitle && <Text style={styles.heroSub}>{subtitle}</Text>}
        </View>
      </View>
      {children}
    </LinearGradient>
  );
}

export function Card({
  children,
  style,
  elevated = true,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  elevated?: boolean;
}) {
  return <View style={[styles.card, elevated && shadow('md'), style]}>{children}</View>;
}

/** A circular tinted glyph chip used to lead cards/rows. */
export function IconChip({
  glyph,
  tone = 'blue',
  size = 44,
}: {
  glyph: string;
  tone?: 'blue' | 'green' | 'amber' | 'red';
  size?: number;
}) {
  const map = {
    blue: { bg: colors.tintBlue, fg: colors.primary },
    green: { bg: colors.tintGreen, fg: colors.accentDark },
    amber: { bg: colors.tintAmber, fg: colors.warning },
    red: { bg: colors.tintRed, fg: colors.danger },
  } as const;
  const c = map[tone];
  return (
    <View
      style={[
        styles.iconChip,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: c.bg },
      ]}
    >
      <Text style={{ fontSize: size * 0.46, color: c.fg }}>{glyph}</Text>
    </View>
  );
}

/** Large tappable tile with an icon, title and subtitle — the home actions. */
export function ActionTile({
  glyph,
  title,
  subtitle,
  tone = 'blue',
  onPress,
  disabled,
}: {
  glyph: string;
  title: string;
  subtitle: string;
  tone?: 'blue' | 'green' | 'amber' | 'red';
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.tile,
        shadow('md'),
        { opacity: disabled ? 0.5 : pressed ? 0.92 : 1, transform: [{ scale: pressed ? 0.99 : 1 }] },
      ]}
    >
      <IconChip glyph={glyph} tone={tone} />
      <View style={{ flex: 1 }}>
        <Text style={styles.tileTitle}>{title}</Text>
        <Text style={styles.tileSub}>{subtitle}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

export function Pill({
  text,
  tone = 'neutral',
  dot,
}: {
  text: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  dot?: boolean;
}) {
  const map = {
    neutral: { bg: '#E8EEF4', fg: colors.primaryDark },
    success: { bg: colors.tintGreen, fg: colors.accentDark },
    warning: { bg: colors.tintAmber, fg: colors.warning },
    danger: { bg: colors.tintRed, fg: colors.danger },
  } as const;
  const c = map[tone];
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      {dot && <View style={[styles.dot, { backgroundColor: c.fg }]} />}
      <Text style={[styles.pillText, { color: c.fg }]}>{text}</Text>
    </View>
  );
}

/** Compact stat card (number over label) for dashboards. */
export function StatTile({
  value,
  label,
  tone = 'blue',
  glyph,
}: {
  value: string | number;
  label: string;
  tone?: 'blue' | 'green' | 'amber';
  glyph?: string;
}) {
  const accent =
    tone === 'green' ? colors.accentDark : tone === 'amber' ? colors.warning : colors.primary;
  return (
    <View style={[styles.statTile, shadow('sm')]}>
      {!!glyph && <Text style={[styles.statGlyph, { color: accent }]}>{glyph}</Text>}
      <Text style={[styles.statValue, { color: accent }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statRowLabel}>{label}</Text>
      <Text style={styles.statRowValue}>{value}</Text>
    </View>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

const styles = StyleSheet.create({
  btnWrap: { borderRadius: radius.md, overflow: 'hidden' },
  btn: {
    minHeight: 54,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  btnBordered: { borderWidth: 1.5, borderColor: colors.borderStrong },
  btnText: { fontSize: font.h3, fontWeight: '700', letterSpacing: 0.2 },
  btnIcon: { fontSize: font.h3 },

  hero: {
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  heroGlyphWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroGlyph: { fontSize: 26 },
  heroTitle: { fontSize: font.h1, fontWeight: '800', color: colors.white, letterSpacing: 0.2 },
  heroSub: { fontSize: font.small, color: 'rgba(255,255,255,0.82)', marginTop: 3, lineHeight: 19 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },

  iconChip: { alignItems: 'center', justifyContent: 'center' },

  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tileTitle: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  tileSub: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  chevron: { fontSize: 28, color: colors.textFaint, fontWeight: '300', paddingHorizontal: spacing.xs },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  pillText: { fontSize: font.small, fontWeight: '700' },
  dot: { width: 7, height: 7, borderRadius: 999 },

  statTile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  statGlyph: { fontSize: 18, marginBottom: 2 },
  statValue: { fontSize: font.h1, fontWeight: '800' },
  statLabel: { fontSize: font.tiny, color: colors.textMuted, marginTop: 2, textAlign: 'center', fontWeight: '600' },

  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  statRowLabel: { fontSize: font.body, color: colors.textMuted },
  statRowValue: { fontSize: font.body, fontWeight: '700', color: colors.text },

  sectionTitle: {
    fontSize: font.small,
    fontWeight: '800',
    color: colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
});
