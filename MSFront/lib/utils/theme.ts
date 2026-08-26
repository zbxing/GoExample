import type { ThemeMode } from '@/lib/types/management';

export const THEME_STORAGE_KEY = 'msfront:theme';

export const themeClassMap: Record<ThemeMode, string> = {
  system: 'theme-system',
  aurora: 'theme-aurora',
  graphite: 'theme-graphite',
  ocean: 'theme-ocean',
  gva: 'theme-gva',
};
