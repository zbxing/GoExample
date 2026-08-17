'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useTheme } from '@/providers/theme-provider';

export type GvaTabMode = 'chrome' | 'button' | 'slider';

export interface GvaShellSettings {
  darkSider: boolean;
  tabMode: GvaTabMode;
  showTabIcon: boolean;
}

const STORAGE_KEY = 'msfront:gva-shell-settings';

export const defaultGvaShellSettings: GvaShellSettings = {
  darkSider: false,
  tabMode: 'chrome',
  showTabIcon: true,
};

const settingsListeners = new Set<() => void>();
let cachedSettingsRaw: string | null | undefined;
let cachedSettings: GvaShellSettings = defaultGvaShellSettings;

function emitSettings() {
  for (const listener of settingsListeners) {
    listener();
  }
}

function settingsEqual(a: GvaShellSettings, b: GvaShellSettings) {
  return (
    a.darkSider === b.darkSider &&
    a.tabMode === b.tabMode &&
    a.showTabIcon === b.showTabIcon
  );
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
    const next = raw
      ? { ...defaultGvaShellSettings, ...(JSON.parse(raw) as GvaShellSettings) }
      : defaultGvaShellSettings;
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
  const payload = JSON.stringify(settings);
  window.localStorage.setItem(STORAGE_KEY, payload);
  cachedSettingsRaw = payload;
  cachedSettings = settings;
  emitSettings();
}

export function subscribeGvaShellSettings(listener: () => void) {
  settingsListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) {
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

interface GvaSettingDrawerProps {
  open: boolean;
  onClose: () => void;
  settings: GvaShellSettings;
  onChange: (next: GvaShellSettings) => void;
}

export function GvaSettingDrawer({
  open,
  onClose,
  settings,
  onChange,
}: GvaSettingDrawerProps) {
  const { theme, setTheme } = useTheme();
  const [tab, setTab] = useState<'appearance' | 'layout' | 'general'>('appearance');
  const isDark = theme === 'graphite';

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="gvaDrawerRoot">
      <button type="button" className="gvaDrawerMask" aria-label="关闭设置" onClick={onClose} />
      <aside className="gvaDrawer" role="dialog" aria-modal="true" aria-label="系统配置">
        <header className="gvaDrawerHeader">
          <span>系统配置</span>
          <div className="gvaDrawerHeaderActions">
            <button
              type="button"
              className="elButton"
              onClick={() => {
                onChange(defaultGvaShellSettings);
                setTheme('gva');
              }}
            >
              重置配置
            </button>
            <button type="button" className="gvaIconButton" aria-label="关闭" onClick={onClose}>
              <X size={14} />
            </button>
          </div>
        </header>

        <div className="gvaDrawerBody">
          <div className="gvaDrawerTabs">
            {(
              [
                ['appearance', '外观'],
                ['layout', '布局'],
                ['general', '通用'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={tab === key ? 'active' : undefined}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'appearance' ? (
            <div className="gvaDrawerSection">
              <label className="gvaDrawerRow">
                <span>深色模式</span>
                <input
                  type="checkbox"
                  checked={isDark}
                  onChange={(event) => setTheme(event.target.checked ? 'graphite' : 'gva')}
                />
              </label>
              <label className="gvaDrawerRow">
                <span>深色侧边栏</span>
                <input
                  type="checkbox"
                  checked={settings.darkSider}
                  onChange={(event) =>
                    onChange({ ...settings, darkSider: event.target.checked })
                  }
                />
              </label>
              <p className="gvaDrawerHint">主题色固定为 GVA 主色 #2264f2。</p>
            </div>
          ) : null}

          {tab === 'layout' ? (
            <div className="gvaDrawerSection">
              <div className="gvaDrawerLabel">标签风格</div>
              <div className="gvaDrawerChipGroup">
                {(
                  [
                    ['chrome', 'Chrome'],
                    ['button', 'Button'],
                    ['slider', 'Slider'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    className={settings.tabMode === mode ? 'active' : undefined}
                    onClick={() => onChange({ ...settings, tabMode: mode })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="gvaDrawerRow">
                <span>标签显示图标</span>
                <input
                  type="checkbox"
                  checked={settings.showTabIcon}
                  onChange={(event) =>
                    onChange({ ...settings, showTabIcon: event.target.checked })
                  }
                />
              </label>
              <p className="gvaDrawerHint">布局模式对齐 GVA normal：顶栏通栏 + 左侧菜单。</p>
            </div>
          ) : null}

          {tab === 'general' ? (
            <div className="gvaDrawerSection">
              <p className="gvaDrawerHint">
                侧栏默认宽度 256px，折叠 80px；菜单项高度 48px。更多高级项可在后续接入 Nest
                配置接口。
              </p>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
