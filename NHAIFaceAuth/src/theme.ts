/** Design tokens for a polished, gov-modern NHAI look. */
import { Platform, ViewStyle } from 'react-native';

export const colors = {
  primary: '#0B5394', // NHAI-ish deep blue
  primaryDark: '#073763',
  primaryLight: '#2E7CC4',
  accent: '#15A24A', // highway green
  accentDark: '#0E7A37',
  danger: '#C0392B',
  warning: '#E67E22',
  bg: '#EEF2F6',
  bgDeep: '#E3E9F0',
  surface: '#FFFFFF',
  surfaceAlt: '#F7F9FC',
  text: '#16202B',
  textMuted: '#677687',
  textFaint: '#9AA7B5',
  border: '#E4EAF1',
  borderStrong: '#D2DBE6',
  overlay: 'rgba(7, 55, 99, 0.55)',
  success: '#15A24A',
  white: '#FFFFFF',
  // Soft tints for icon chips / stat backgrounds.
  tintBlue: '#E7F0F9',
  tintGreen: '#E3F6EA',
  tintAmber: '#FDF1E3',
  tintRed: '#FBE7E4',
};

/** Hero / accent gradients (consumed by expo-linear-gradient). */
export const gradients = {
  hero: ['#0B5394', '#0E6BB0', '#073763'] as const,
  accent: ['#15A24A', '#0E7A37'] as const,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 44,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 24,
  pill: 999,
};

export const font = {
  display: 30,
  h1: 26,
  h2: 20,
  h3: 17,
  body: 15,
  small: 13,
  tiny: 11,
};

/** Cross-platform elevation presets. iOS uses shadow*, Android uses elevation. */
export const shadow = (level: 'sm' | 'md' | 'lg' = 'md'): ViewStyle => {
  const map = {
    sm: { e: 2, o: 0.06, r: 4, y: 1 },
    md: { e: 5, o: 0.1, r: 12, y: 4 },
    lg: { e: 10, o: 0.16, r: 24, y: 10 },
  } as const;
  const s = map[level];
  return Platform.select<ViewStyle>({
    android: { elevation: s.e },
    default: {
      shadowColor: '#0B2540',
      shadowOpacity: s.o,
      shadowRadius: s.r,
      shadowOffset: { width: 0, height: s.y },
    },
  })!;
};
