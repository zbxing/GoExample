export type GvaTabMode = 'chrome' | 'button' | 'slider';
export type GvaThemeScheme = 'light' | 'dark' | 'auto';
export type GvaLayoutMode = 'normal' | 'head' | 'combination' | 'sidebar' | 'vertical';
export type GvaMenuTheme = 'design' | 'light' | 'group';
export type GvaCardMode = 'border' | 'shadow';
export type GvaSize = 'default' | 'large' | 'small';
export type GvaShadow = 'none' | 'sm' | 'md' | 'lg';
export type GvaPageTransition = 'fade' | 'slide' | 'zoom' | 'none';

export interface GvaShellSettings {
  themeScheme: GvaThemeScheme;
  grayscale: boolean;
  colourWeakness: boolean;
  themeColor: string;
  themeRadius: number;
  size: GvaSize;
  otherColor: {
    info: string;
    success: string;
    warning: string;
    error: string;
  };
  isInfoFollowPrimary: boolean;
  layout: {
    mode: GvaLayoutMode;
    sideWidth: number;
    sideCollapsedWidth: number;
    sideItemHeight: number;
  };
  page: {
    transition: GvaPageTransition;
  };
  header: {
    breadcrumb: { visible: boolean; showIcon: boolean };
    refresh: { visible: boolean };
    search: { visible: boolean };
    collapseButton: { visible: boolean };
    bg: string;
    shadow: GvaShadow;
  };
  tab: {
    visible: boolean;
    bg: string;
    shadow: GvaShadow;
    mode: GvaTabMode;
    showIcon: boolean;
  };
  menu: {
    theme: GvaMenuTheme;
    darkSider: boolean;
  };
  card: {
    mode: GvaCardMode;
  };
  watermark: {
    visible: boolean;
  };
}

export interface GvaThemePreset {
  name: string;
  builtin?: boolean;
  minMainVersion?: string;
  theme: Partial<GvaShellSettings> & {
    otherColor?: Partial<GvaShellSettings['otherColor']>;
    layout?: Partial<GvaShellSettings['layout']>;
    page?: Partial<GvaShellSettings['page']>;
    header?: Partial<GvaShellSettings['header']> & {
      breadcrumb?: Partial<GvaShellSettings['header']['breadcrumb']>;
      refresh?: Partial<GvaShellSettings['header']['refresh']>;
      search?: Partial<GvaShellSettings['header']['search']>;
      collapseButton?: Partial<GvaShellSettings['header']['collapseButton']>;
    };
    tab?: Partial<GvaShellSettings['tab']>;
    menu?: Partial<GvaShellSettings['menu']>;
    card?: Partial<GvaShellSettings['card']>;
    watermark?: Partial<GvaShellSettings['watermark']>;
  };
}

export const STORAGE_KEY = 'msfront:gva-shell-settings';
export const PRESET_STORAGE_KEY = 'msfront:gva-theme-presets';

export const defaultGvaShellSettings: GvaShellSettings = {
  themeScheme: 'auto',
  grayscale: false,
  colourWeakness: false,
  themeColor: '#2264f2',
  themeRadius: 0.5,
  size: 'default',
  otherColor: {
    info: '#909399',
    success: '#60c041',
    warning: '#f9901f',
    error: '#f56c6c',
  },
  isInfoFollowPrimary: false,
  layout: {
    mode: 'normal',
    sideWidth: 256,
    sideCollapsedWidth: 80,
    sideItemHeight: 48,
  },
  page: {
    transition: 'slide',
  },
  header: {
    breadcrumb: { visible: true, showIcon: true },
    refresh: { visible: true },
    search: { visible: true },
    collapseButton: { visible: true },
    bg: '',
    shadow: 'sm',
  },
  tab: {
    visible: true,
    bg: '',
    shadow: 'sm',
    mode: 'chrome',
    showIcon: true,
  },
  menu: {
    theme: 'light',
    darkSider: false,
  },
  card: {
    mode: 'border',
  },
  watermark: {
    visible: false,
  },
};

export const THEME_PRESET_COLORS = [
  { color: '#2264f2', name: '默认' },
  { color: '#b48df3', name: '雅紫' },
  { color: '#1d84ff', name: '天蓝' },
  { color: '#60c041', name: '清新绿' },
  { color: '#38c0fc', name: '湖青' },
  { color: '#f9901f', name: '活力橙' },
  { color: '#ff80c8', name: '樱粉' },
] as const;

export const SEMANTIC_SWATCHES = [
  '#67c23a',
  '#e6a23c',
  '#f56c6c',
  '#909399',
  '#60c041',
  '#f9901f',
  '#2264f2',
  '#38c0fc',
];

export const BUILTIN_PRESETS: GvaThemePreset[] = [
  {
    name: 'GVA-科技蓝',
    builtin: true,
    theme: {
      themeScheme: 'auto',
      themeColor: '#2264f2',
      themeRadius: 0.5,
      layout: { mode: 'normal', sideWidth: 256, sideCollapsedWidth: 80, sideItemHeight: 48 },
      tab: { mode: 'chrome', showIcon: true, visible: true, shadow: 'sm', bg: '' },
      menu: { theme: 'light', darkSider: false },
      card: { mode: 'border' },
    },
  },
  {
    name: 'GVA 经典蓝',
    builtin: true,
    theme: {
      themeScheme: 'auto',
      themeColor: '#3b82f6',
      themeRadius: 0.25,
      header: {
        breadcrumb: { visible: true, showIcon: false },
        refresh: { visible: true },
        search: { visible: true },
        collapseButton: { visible: true },
        bg: '',
        shadow: 'sm',
      },
      menu: { theme: 'light', darkSider: false },
      card: { mode: 'border' },
    },
  },
  {
    name: 'Azir-清新蓝',
    builtin: true,
    theme: {
      themeScheme: 'auto',
      themeColor: '#2264f2',
      themeRadius: 0.5,
      layout: { mode: 'vertical', sideWidth: 256, sideCollapsedWidth: 80, sideItemHeight: 48 },
      header: {
        breadcrumb: { visible: true, showIcon: true },
        refresh: { visible: true },
        search: { visible: true },
        collapseButton: { visible: true },
        bg: 'rgba(255, 255, 255, 0)',
        shadow: 'none',
      },
      tab: { visible: true, shadow: 'none', mode: 'button', bg: 'rgba(255, 255, 255, 0)', showIcon: true },
      menu: { theme: 'design', darkSider: false },
      card: { mode: 'border' },
    },
  },
  {
    name: '暗夜深色',
    builtin: true,
    theme: {
      themeScheme: 'dark',
      themeColor: '#2264f2',
      themeRadius: 0.5,
      menu: { theme: 'light', darkSider: true },
      card: { mode: 'shadow' },
    },
  },
];

const HEADER_SHADOWS: Record<GvaShadow, string> = {
  none: 'none',
  sm: '0 1px 0 rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.04)',
  md: '0 2px 8px rgba(0, 21, 41, 0.08)',
  lg: '0 8px 24px rgba(0, 21, 41, 0.12)',
};

const TAB_SHADOWS: Record<GvaShadow, string> = {
  none: 'none',
  sm: '0 1px 2px rgba(0, 21, 41, 0.08)',
  md: '0 2px 8px rgba(0, 21, 41, 0.08)',
  lg: '0 8px 18px rgba(0, 21, 41, 0.12)',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeDeep<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const next = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in base) || value === undefined) {
      continue;
    }
    const current = next[key];
    if (isRecord(current) && isRecord(value)) {
      next[key] = mergeDeep(current, value);
    } else {
      next[key] = value;
    }
  }
  return next as T;
}

export function cloneGvaShellSettings(settings: GvaShellSettings = defaultGvaShellSettings): GvaShellSettings {
  return structuredClone(settings);
}

export function normalizeGvaShellSettings(raw: unknown): GvaShellSettings {
  const next = cloneGvaShellSettings();
  if (!isRecord(raw)) {
    return next;
  }

  if (typeof raw.darkSider === 'boolean' && !isRecord(raw.menu)) {
    next.menu.darkSider = raw.darkSider;
  }
  if (
    (raw.tabMode === 'chrome' || raw.tabMode === 'button' || raw.tabMode === 'slider') &&
    !isRecord(raw.tab)
  ) {
    next.tab.mode = raw.tabMode;
  }
  if (typeof raw.showTabIcon === 'boolean' && !isRecord(raw.tab)) {
    next.tab.showIcon = raw.showTabIcon;
  }

  const merged = mergeDeep(next as unknown as Record<string, unknown>, raw) as unknown as GvaShellSettings;
  if (merged.menu.theme === ('dark' as GvaMenuTheme)) {
    merged.menu.theme = 'light';
    merged.menu.darkSider = true;
  }
  if (merged.isInfoFollowPrimary) {
    merged.otherColor.info = merged.themeColor;
  }
  return merged;
}

export function applyPresetToSettings(preset: GvaThemePreset, current = defaultGvaShellSettings): GvaShellSettings {
  return normalizeGvaShellSettings(
    mergeDeep(cloneGvaShellSettings(current) as unknown as Record<string, unknown>, preset.theme as Record<string, unknown>),
  );
}

export function hexToRgbChannels(color: string): string {
  const hex = color.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(hex);
  const long = /^#([0-9a-f]{6})$/i.exec(hex);
  if (short) {
    const [r, g, b] = short[1].split('').map((part) => Number.parseInt(part + part, 16));
    return `${r}, ${g}, ${b}`;
  }
  if (long) {
    const value = Number.parseInt(long[1], 16);
    return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(hex);
  if (rgb) {
    return `${rgb[1]}, ${rgb[2]}, ${rgb[3]}`;
  }
  return '34, 100, 242';
}

export function mixPrimarySoft(color: string): string {
  const [r, g, b] = hexToRgbChannels(color)
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10));
  const mix = (channel: number) => Math.round(channel + (255 - channel) * 0.88);
  return `${mix(r)}, ${mix(g)}, ${mix(b)}`;
}

export function addOpacityToColor(color: string, opacity: number): string {
  return `rgba(${hexToRgbChannels(color)}, ${opacity})`;
}

export function applyGvaShellCss(settings: GvaShellSettings) {
  if (typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  const primary = hexToRgbChannels(settings.themeColor);
  root.style.setProperty('--gva-primary', primary);
  root.style.setProperty('--gva-primary-50', mixPrimarySoft(settings.themeColor));
  root.style.setProperty('--accent-primary', settings.themeColor);
  root.style.setProperty('--el-color-primary', settings.themeColor);
  root.style.setProperty('--gva-sidebar-active', settings.themeColor);
  root.style.setProperty('--gva-radius', `${settings.themeRadius}rem`);
  root.style.setProperty('--gva-side-width', `${settings.layout.sideWidth}px`);
  root.style.setProperty('--gva-side-collapsed-width', `${settings.layout.sideCollapsedWidth}px`);
  root.style.setProperty('--gva-side-item-height', `${settings.layout.sideItemHeight}px`);
  root.style.setProperty('--gva-header-shadow', HEADER_SHADOWS[settings.header.shadow]);
  root.style.setProperty('--gva-tab-shadow', TAB_SHADOWS[settings.tab.shadow]);
  root.style.setProperty('--tone-success', settings.otherColor.success);
  root.style.setProperty('--tone-warning', settings.otherColor.warning);
  root.style.setProperty('--tone-danger', settings.otherColor.error);
  root.style.setProperty('--tone-info', settings.isInfoFollowPrimary ? settings.themeColor : settings.otherColor.info);
  if (settings.header.bg) {
    root.style.setProperty('--gva-header-bg', settings.header.bg);
  } else {
    root.style.removeProperty('--gva-header-bg');
  }
  if (settings.tab.bg) {
    root.style.setProperty('--gva-tab-bg', settings.tab.bg);
  } else {
    root.style.removeProperty('--gva-tab-bg');
  }
  root.classList.toggle('gva-grayscale', settings.grayscale);
  root.classList.toggle('gva-colour-weakness', settings.colourWeakness);
  root.dataset.gvaSize = settings.size;
  root.dataset.gvaCard = settings.card.mode;
  root.dataset.gvaLayout = settings.layout.mode;
}

export function loadCustomPresets(): GvaThemePreset[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PRESET_STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is GvaThemePreset => isRecord(item) && typeof item.name === 'string')
      : [];
  } catch {
    return [];
  }
}

function saveCustomPresets(list: GvaThemePreset[]) {
  window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(list));
}

export function addCustomPreset(preset: GvaThemePreset): GvaThemePreset[] {
  const list = loadCustomPresets().filter((item) => item.name !== preset.name);
  list.push(preset);
  saveCustomPresets(list);
  return list;
}

export function removeCustomPreset(name: string): GvaThemePreset[] {
  const list = loadCustomPresets().filter((preset) => preset.name !== name);
  saveCustomPresets(list);
  return list;
}

export function exportCurrentPreset(settings: GvaShellSettings, name: string): GvaThemePreset {
  return {
    name,
    theme: cloneGvaShellSettings(settings),
  };
}

const settingsListeners = new Set<() => void>();
let cachedSettingsRaw: string | null | undefined;
let cachedSettings: GvaShellSettings = defaultGvaShellSettings;

function emitSettings() {
  for (const listener of settingsListeners) {
    listener();
  }
}

export function settingsEqual(a: GvaShellSettings, b: GvaShellSettings) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function readGvaShellSettings(): GvaShellSettings {
  if (typeof window === 'undefined') {
    return defaultGvaShellSettings;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === cachedSettingsRaw) {
      return cachedSettings;
    }
    cachedSettingsRaw = raw;
    const next = normalizeGvaShellSettings(raw ? JSON.parse(raw) : null);
    if (settingsEqual(next, cachedSettings)) {
      return cachedSettings;
    }
    cachedSettings = next;
    return cachedSettings;
  } catch {
    cachedSettingsRaw = null;
    cachedSettings = defaultGvaShellSettings;
    return cachedSettings;
  }
}

export function writeGvaShellSettings(settings: GvaShellSettings) {
  if (typeof window === 'undefined') {
    return;
  }
  const normalized = normalizeGvaShellSettings(settings);
  const payload = JSON.stringify(normalized);
  window.localStorage.setItem(STORAGE_KEY, payload);
  cachedSettingsRaw = payload;
  cachedSettings = normalized;
  emitSettings();
}

export function subscribeGvaShellSettings(listener: () => void) {
  settingsListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === PRESET_STORAGE_KEY || event.key === null) {
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    settingsListeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function getGvaShellSettingsServerSnapshot() {
  return defaultGvaShellSettings;
}

export function parseImportedPreset(text: string): GvaThemePreset | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }
    const theme = isRecord(parsed.theme) ? parsed.theme : parsed;
    return {
      name: typeof parsed.name === 'string' ? parsed.name : 'imported',
      builtin: Boolean(parsed.builtin),
      theme: theme as GvaThemePreset['theme'],
    };
  } catch {
    return null;
  }
}
