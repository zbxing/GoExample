import type { ThemeMode } from '@/lib/types/management';

export const THEME_STORAGE_KEY = 'msfront:theme';

export const themeClassMap: Record<ThemeMode, string> = {
  system: 'theme-system',
  aurora: 'theme-aurora',
  graphite: 'theme-graphite',
  ocean: 'theme-ocean',
  fna: 'theme-fna',
};

/** 将历史主题 id（ga / gva）归一为当前 fna */
export function normalizeStoredThemeMode(
  value: string | null | undefined,
  allowed: readonly string[],
): ThemeMode | null {
  if (!value) {
    return null;
  }
  const migrated = value === 'ga' || value === 'gva' ? 'fna' : value;
  if (!allowed.includes(migrated)) {
    return null;
  }
  return migrated as ThemeMode;
}
