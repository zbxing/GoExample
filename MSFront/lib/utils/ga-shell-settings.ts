export type GvaTabMode = 'chrome' | 'button' | 'slider';
export type GvaThemeScheme = 'light' | 'dark' | 'auto';
export type GvaLayoutMode = 'normal' | 'head' | 'combination' | 'sidebar' | 'vertical';
export type GvaMenuTheme = 'design' | 'light' | 'group';
/** 侧边栏折叠：默认仅当前路径 / 全部展开 / 自定义多开 */
export type GvaMenuCollapseMode = 'current' | 'all' | 'custom';
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
    /** 顶栏路由进度条，默认开启 */
    showProgress: boolean;
  };
  menu: {
    theme: GvaMenuTheme;
    collapseMode: GvaMenuCollapseMode;
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
  themeRadius: 0.625,
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
    showProgress: true,
  },
  menu: {
    theme: 'light',
    collapseMode: 'current',
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
      themeRadius: 0.625,
      layout: { mode: 'normal', sideWidth: 256, sideCollapsedWidth: 80, sideItemHeight: 48 },
      tab: { mode: 'chrome', showIcon: true, showProgress: true, visible: true, shadow: 'sm', bg: '' },
      menu: { theme: 'light', collapseMode: 'current', darkSider: false },
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
      menu: { theme: 'light', collapseMode: 'current', darkSider: false },
      card: { mode: 'border' },
    },
  },
  {
    name: 'Azir-清新蓝',
    builtin: true,
    theme: {
      themeScheme: 'auto',
      themeColor: '#2264f2',
      themeRadius: 0.625,
      layout: { mode: 'vertical', sideWidth: 256, sideCollapsedWidth: 80, sideItemHeight: 48 },
      header: {
        breadcrumb: { visible: true, showIcon: true },
        refresh: { visible: true },
        search: { visible: true },
        collapseButton: { visible: true },
        bg: 'rgba(255, 255, 255, 0)',
        shadow: 'none',
      },
      tab: {
        visible: true,
        shadow: 'none',
        mode: 'button',
        bg: 'rgba(255, 255, 255, 0)',
        showIcon: true,
        showProgress: true,
      },
      menu: { theme: 'design', collapseMode: 'current', darkSider: false },
      card: { mode: 'border' },
    },
  },
  {
    name: '暗夜深色',
    builtin: true,
    theme: {
      themeScheme: 'dark',
      themeColor: '#2264f2',
      themeRadius: 0.625,
      menu: { theme: 'light', collapseMode: 'current', darkSider: true },
      card: { mode: 'shadow' },
    },
  },
];

const HEADER_SHADOWS_LIGHT: Record<GvaShadow, string> = {
  none: 'none',
  sm: '0 1px 0 rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.04)',
  md: '0 1px 0 rgba(0, 0, 0, 0.06), 0 4px 12px rgba(0, 0, 0, 0.08)',
  lg: '0 1px 0 rgba(0, 0, 0, 0.06), 0 8px 24px rgba(0, 0, 0, 0.12)',
};

const HEADER_SHADOWS_DARK: Record<GvaShadow, string> = {
  none: 'none',
  sm: '0 1px 0 rgba(0, 0, 0, 0.4), 0 1px 3px rgba(0, 0, 0, 0.35)',
  md: '0 1px 0 rgba(0, 0, 0, 0.4), 0 4px 12px rgba(0, 0, 0, 0.45)',
  lg: '0 1px 0 rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.55)',
};

const TAB_SHADOWS_LIGHT: Record<GvaShadow, string> = {
  none: 'none',
  sm: '0 1px 2px rgba(0, 21, 41, 0.08)',
  md: '0 2px 8px rgba(0, 21, 41, 0.12)',
  lg: '0 6px 18px rgba(0, 21, 41, 0.16)',
};

const TAB_SHADOWS_DARK: Record<GvaShadow, string> = {
  none: 'none',
  sm: '0 1px 3px rgba(0, 0, 0, 0.35)',
  md: '0 2px 8px rgba(0, 0, 0, 0.45)',
  lg: '0 6px 18px rgba(0, 0, 0, 0.55)',
};

function isDocumentDark() {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

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
  const collapseModes: GvaMenuCollapseMode[] = ['current', 'all', 'custom'];
  if (!collapseModes.includes(merged.menu.collapseMode)) {
    merged.menu.collapseMode = 'current';
  }
  if (merged.isInfoFollowPrimary) {
    merged.otherColor.info = merged.themeColor;
  }

  const layoutModes: GvaLayoutMode[] = ['normal', 'head', 'combination', 'sidebar', 'vertical'];
  if (!layoutModes.includes(merged.layout.mode)) {
    merged.layout.mode = 'normal';
  }
  // 侧栏宽度异常（0 / NaN）会导致左侧栏“消失”
  if (!Number.isFinite(merged.layout.sideWidth) || merged.layout.sideWidth < 160) {
    merged.layout.sideWidth = 256;
  }
  if (merged.layout.sideWidth > 480) {
    merged.layout.sideWidth = 480;
  }
  if (!Number.isFinite(merged.layout.sideCollapsedWidth) || merged.layout.sideCollapsedWidth < 48) {
    merged.layout.sideCollapsedWidth = 80;
  }
  if (!Number.isFinite(merged.layout.sideItemHeight) || merged.layout.sideItemHeight < 32) {
    merged.layout.sideItemHeight = 48;
  }
  if (typeof merged.tab.showProgress !== 'boolean') {
    merged.tab.showProgress = true;
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

export function mixPrimarySoft(color: string, towardDark = false): string {
  const [r, g, b] = hexToRgbChannels(color)
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10));
  // 浅色：向白混合（GVA primary-50）
  // 暗色：与 slate-900 混合，主色占比要高，选中标签才有可见蓝底（参考截图 ≈ 56,101,186）
  if (towardDark) {
    const mix = (channel: number, base: number) => Math.round(base * 0.28 + channel * 0.72);
    return `${mix(r, 15)}, ${mix(g, 23)}, ${mix(b, 42)}`;
  }
  const mix = (channel: number) => Math.round(channel + (255 - channel) * 0.88);
  return `${mix(r)}, ${mix(g)}, ${mix(b)}`;
}

export function addOpacityToColor(color: string, opacity: number): string {
  return `rgba(${hexToRgbChannels(color)}, ${opacity})`;
}

/** 对齐 GVA theme/color.js autoDarkColor：自定义顶栏/标签栏背景在暗色下自动压暗 */
export function autoDarkColor(color: string): string {
  const channels = hexToRgbChannels(color)
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10));
  if (channels.length < 3 || channels.some((n) => Number.isNaN(n))) {
    return color;
  }
  const [r, g, b] = channels;
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  const nextLightness = Math.min(0.45, Math.max(0.06, (1 - l) * 0.2 + 0.06));
  const nextSaturation = Math.min(s, 0.6);
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  let nr: number;
  let ng: number;
  let nb: number;
  if (nextSaturation === 0) {
    nr = ng = nb = Math.round(nextLightness * 255);
  } else {
    const q =
      nextLightness < 0.5
        ? nextLightness * (1 + nextSaturation)
        : nextLightness + nextSaturation - nextLightness * nextSaturation;
    const p = 2 * nextLightness - q;
    const hh = h / 360;
    nr = Math.round(hue2rgb(p, q, hh + 1 / 3) * 255);
    ng = Math.round(hue2rgb(p, q, hh) * 255);
    nb = Math.round(hue2rgb(p, q, hh - 1 / 3) * 255);
  }
  return `rgba(${nr}, ${ng}, ${nb}, 1)`;
}

function mixHexToward(color: string, target: '#ffffff' | '#000000', amount: number): string {
  const [r, g, b] = hexToRgbChannels(color)
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10));
  const [tr, tg, tb] = hexToRgbChannels(target)
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10));
  const mix = (a: number, t: number) => Math.round(a * (1 - amount) + t * amount);
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(mix(r, tr))}${toHex(mix(g, tg))}${toHex(mix(b, tb))}`;
}

/** 对齐 GVA setElementPlusPrimaryColor：写入 primary 明暗阶与菜单悬停色 */
function applyElementPlusPrimaryLadder(color: string, dark: boolean) {
  const root = document.documentElement.style;
  const toward = dark ? '#000000' : '#ffffff';
  root.setProperty('--el-color-primary', color);
  for (let times = 1; times <= 2; times += 1) {
    root.setProperty(`--el-color-primary-dark-${times}`, mixHexToward(color, '#000000', times / 10));
  }
  for (let times = 1; times <= 9; times += 1) {
    root.setProperty(`--el-color-primary-light-${times}`, mixHexToward(color, toward, times / 10));
  }
  root.setProperty('--el-color-primary-light-10', mixHexToward(color, toward, 1));
  root.setProperty('--el-color-primary-bg', addOpacityToColor(color, 0.4));
  root.setProperty('--el-menu-hover-bg-color', addOpacityToColor(color, 0.2));
}

export function applyGvaShellCss(settings: GvaShellSettings) {
  if (typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  const primary = hexToRgbChannels(settings.themeColor);
  const dark = isDocumentDark();
  root.style.setProperty('--gva-primary', primary);
  root.style.setProperty('--primary-color', primary);
  root.style.setProperty('--gva-primary-50', mixPrimarySoft(settings.themeColor, dark));
  root.style.setProperty('--primary-50-color', mixPrimarySoft(settings.themeColor, dark));
  root.style.setProperty('--accent-primary', settings.themeColor);
  root.style.setProperty('--gva-sidebar-active', settings.themeColor);
  applyElementPlusPrimaryLadder(settings.themeColor, dark);
  // 对齐 GVA applyElementPlusTheme：内容圆角 + Element 系控件圆角同源
  const radius = `${settings.themeRadius}rem`;
  root.style.setProperty('--gva-radius', radius);
  root.style.setProperty('--el-border-radius-base', radius);
  root.style.setProperty('--el-card-border-radius', radius);
  root.style.setProperty('--gva-side-width', `${settings.layout.sideWidth}px`);
  root.style.setProperty('--gva-side-collapsed-width', `${settings.layout.sideCollapsedWidth}px`);
  root.style.setProperty('--gva-side-item-height', `${settings.layout.sideItemHeight}px`);
  const headerShadows = dark ? HEADER_SHADOWS_DARK : HEADER_SHADOWS_LIGHT;
  const tabShadows = dark ? TAB_SHADOWS_DARK : TAB_SHADOWS_LIGHT;
  root.style.setProperty('--gva-header-shadow', headerShadows[settings.header.shadow]);
  root.style.setProperty('--gva-tab-shadow', tabShadows[settings.tab.shadow]);
  root.style.setProperty('--gva-tabs-shadow', tabShadows[settings.tab.shadow]);
  root.style.setProperty('--tone-success', settings.otherColor.success);
  root.style.setProperty('--tone-warning', settings.otherColor.warning);
  root.style.setProperty('--tone-danger', settings.otherColor.error);
  root.style.setProperty('--tone-info', settings.isInfoFollowPrimary ? settings.themeColor : settings.otherColor.info);
  // 对齐 GVA applyChromeTheme：暗色下对自定义顶栏/标签背景跑 autoDarkColor
  if (settings.header.bg) {
    const headerBg = dark ? autoDarkColor(settings.header.bg) : settings.header.bg;
    root.style.setProperty('--gva-header-bg', headerBg);
  } else {
    root.style.removeProperty('--gva-header-bg');
  }
  if (settings.tab.bg) {
    const tabBg = dark ? autoDarkColor(settings.tab.bg) : settings.tab.bg;
    root.style.setProperty('--gva-tab-bg', tabBg);
    root.style.setProperty('--gva-tabs-bg', tabBg);
  } else {
    root.style.removeProperty('--gva-tab-bg');
    root.style.removeProperty('--gva-tabs-bg');
  }
  root.classList.toggle('gva-grayscale', settings.grayscale);
  root.classList.toggle('gva-colour-weakness', settings.colourWeakness);
  root.dataset.gvaSize = settings.size;
  root.dataset.gvaCard = settings.card.mode;
  // 对齐 GVA applyStructureTheme：html.gva-card--border | gva-card--shadow
  root.classList.remove('gva-card--border', 'gva-card--shadow');
  root.classList.add(`gva-card--${settings.card.mode}`);
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
/** 水合完成前禁止读 localStorage，保证与 getServerSnapshot 同一引用 */
let settingsHydrated = false;

function emitSettings() {
  for (const listener of settingsListeners) {
    listener();
  }
}

export function settingsEqual(a: GvaShellSettings, b: GvaShellSettings) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function readGvaShellSettings(): GvaShellSettings {
  if (!settingsHydrated || typeof window === 'undefined') {
    return cachedSettings;
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

/** 客户端挂载后调用：从 localStorage 拉取真实配置并通知订阅者 */
export function hydrateGvaShellSettings() {
  if (typeof window === 'undefined' || settingsHydrated) {
    return;
  }
  settingsHydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    cachedSettingsRaw = raw;
    const next = normalizeGvaShellSettings(raw ? JSON.parse(raw) : null);
    if (!settingsEqual(next, cachedSettings)) {
      cachedSettings = next;
    }
  } catch {
    cachedSettingsRaw = null;
    cachedSettings = defaultGvaShellSettings;
  }
  emitSettings();
}

export function writeGvaShellSettings(settings: GvaShellSettings) {
  if (typeof window === 'undefined') {
    return;
  }
  settingsHydrated = true;
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
      if (settingsHydrated) {
        // 跨标签页变更：强制重读
        cachedSettingsRaw = undefined;
        listener();
      }
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    settingsListeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function getGvaShellSettingsServerSnapshot() {
  // 必须与水合前 readGvaShellSettings() 返回同一引用
  return cachedSettings;
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
