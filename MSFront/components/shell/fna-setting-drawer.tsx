'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Info,
  Monitor,
  Moon,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { AdminSelect } from '@/components/admin/admin-primitives';
import { applyTheme, useTheme } from '@/providers/theme-provider';
import type { ThemeMode } from '@/lib/types/management';
import { showFnaMessage } from '@/lib/utils/fna-message';
import {
  addCustomPreset,
  addOpacityToColor,
  applyPresetToSettings,
  BUILTIN_PRESETS,
  cloneFnaShellSettings,
  exportCurrentPreset,
  hexToRgbChannels,
  loadCustomPresets,
  parseImportedPreset,
  removeCustomPreset,
  SEMANTIC_SWATCHES,
  THEME_PRESET_COLORS,
  type FnaCardMode,
  type FnaLayoutMode,
  type FnaMenuCollapseMode,
  type FnaMenuTheme,
  type FnaPageTransition,
  type FnaShadow,
  type FnaShellSettings,
  type FnaSize,
  type FnaTabMode,
  type FnaThemePreset,
  type FnaThemeScheme,
} from '@/lib/utils/fna-shell-settings';

export type { FnaShellSettings, FnaTabMode };
export {
  defaultFnaShellSettings,
  getFnaShellSettingsServerSnapshot,
  readFnaShellSettings,
  subscribeFnaShellSettings,
  writeFnaShellSettings,
} from '@/lib/utils/fna-shell-settings';

const TABS = [
  { key: 'appearance', label: '外观' },
  { key: 'layout', label: '布局' },
  { key: 'presets', label: '预设' },
  { key: 'general', label: '通用' },
] as const;

interface FnaSettingDrawerProps {
  open: boolean;
  onClose: () => void;
  settings: FnaShellSettings;
  onChange: (next: FnaShellSettings) => void;
}

export function FnaSettingDrawer({
  open,
  onClose,
  settings,
  onChange,
}: FnaSettingDrawerProps) {
  const { setTheme } = useTheme();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('appearance');
  const [confirm, setConfirm] = useState<{ title: string; message: string; onConfirm: () => void } | null>(
    null,
  );
  const [presented, setPresented] = useState(open);

  const saveToastTimer = useRef(0);

  if (open && !presented) {
    setPresented(true);
  }

  const drawerPhase = open ? 'enter' : 'leave';

  useEffect(() => {
    if (!presented) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presented, onClose]);

  useEffect(() => {
    return () => window.clearTimeout(saveToastTimer.current);
  }, []);

  function scheduleSaveToast() {
    window.clearTimeout(saveToastTimer.current);
    saveToastTimer.current = window.setTimeout(() => {
      showFnaMessage.success('保存成功');
    }, 500);
  }

  function patch(next: FnaShellSettings, options?: { silent?: boolean }) {
    onChange(next);
    syncThemeScheme(next.themeScheme, setTheme);
    if (!options?.silent) {
      scheduleSaveToast();
    }
  }

  function resetConfig() {
    window.clearTimeout(saveToastTimer.current);
    patch(cloneFnaShellSettings(), { silent: true });
    showFnaMessage.success('配置已重置');
  }

  if (!presented || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div className={`fnaDrawerRoot fnaThemeDrawer is-${drawerPhase}`}>
      <button type="button" className="fnaDrawerMask" aria-label="关闭设置" onClick={onClose} />
      <aside
        className="fnaDrawer"
        role="dialog"
        aria-modal="true"
        aria-label="系统配置"
        onAnimationEnd={(event) => {
          if (
            event.target !== event.currentTarget ||
            open ||
            event.animationName !== 'fna-rtl-drawer-out'
          ) {
            return;
          }
          setPresented(false);
        }}
      >
        <header className="fnaDrawerHeader">
          <span>系统配置</span>
          <div className="fnaDrawerHeaderActions">
            <button type="button" className="elButton elButtonPrimary fnaDrawerResetBtn" onClick={resetConfig}>
              重置配置
            </button>
            <button type="button" className="fnaDrawerCloseBtn" aria-label="关闭系统配置" onClick={onClose}>
              <X size={14} strokeWidth={2.25} />
            </button>
          </div>
        </header>

        <div className="fnaDrawerBody">
          <div className="fnaDrawerTabs">
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={tab === item.key ? 'active' : undefined}
                style={tab === item.key ? { backgroundColor: settings.themeColor } : undefined}
                onClick={() => setTab(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="fnaThemeSectionContent" key={tab}>
            {tab === 'appearance' ? (
              <AppearancePane settings={settings} onChange={patch} />
            ) : null}
            {tab === 'layout' ? <LayoutPane settings={settings} onChange={patch} /> : null}
            {tab === 'presets' ? (
              <PresetsPane
                settings={settings}
                onChange={patch}
                onConfirm={setConfirm}
              />
            ) : null}
            {tab === 'general' ? (
              <GeneralPane
                settings={settings}
                onReset={() => {
                  setConfirm({
                    title: '重置配置',
                    message: '确定要重置所有配置吗？此操作不可撤销。',
                    onConfirm: resetConfig,
                  });
                }}
              />
            ) : null}
          </div>
        </div>
      </aside>

      {confirm ? (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            confirm.onConfirm();
            setConfirm(null);
          }}
        />
      ) : null}
    </div>,
    document.body,
  );
}

function syncThemeScheme(scheme: FnaThemeScheme, setTheme: (theme: ThemeMode) => void) {
  if (scheme === 'dark') {
    applyTheme('graphite');
    setTheme('graphite');
    return;
  }
  if (scheme === 'light') {
    applyTheme('fna');
    setTheme('fna');
    return;
  }
  setTheme('system');
}

function AppearancePane({
  settings,
  onChange,
}: {
  settings: FnaShellSettings;
  onChange: (next: FnaShellSettings) => void;
}) {
  const showDarkSider = settings.themeScheme !== 'dark' && settings.layout.mode !== 'head';

  return (
    <div className="fnaThemeFont">
      <Section title="主题模式">
        <ThemeModeSelector
          value={settings.themeScheme}
          color={settings.themeColor}
          onChange={(themeScheme) => onChange({ ...settings, themeScheme })}
        />
      </Section>

      <Section title="主题色">
        <ThemeColorPicker
          value={settings.themeColor}
          onChange={(themeColor) =>
            onChange({
              ...settings,
              themeColor,
              otherColor: settings.isInfoFollowPrimary
                ? { ...settings.otherColor, info: themeColor }
                : settings.otherColor,
            })
          }
        />
      </Section>

      <Section title="菜单风格">
        <MenuThemeSelector
          value={settings.menu.theme}
          color={settings.themeColor}
          onChange={(theme) => onChange({ ...settings, menu: { ...settings.menu, theme } })}
        />
        <div className="fnaThemeCardBg" style={{ marginTop: 12 }}>
          <SettingItem label="侧边栏折叠">
            <ThemeSelect
              value={settings.menu.collapseMode}
              options={[
                { label: '默认(仅当前)', value: 'current' },
                { label: '全部(所有)', value: 'all' },
                { label: '自定义', value: 'custom' },
              ]}
              onChange={(collapseMode) =>
                onChange({
                  ...settings,
                  menu: { ...settings.menu, collapseMode: collapseMode as FnaMenuCollapseMode },
                })
              }
            />
          </SettingItem>
          {showDarkSider ? (
            <SettingItem label="深色侧边栏">
              <ThemeSwitch
                checked={settings.menu.darkSider}
                label="深色侧边栏"
                onChange={(darkSider) => onChange({ ...settings, menu: { ...settings.menu, darkSider } })}
              />
            </SettingItem>
          ) : null}
        </div>
      </Section>

      <Section title="标签栏风格">
        <TabModeSelector
          value={settings.tab.mode}
          color={settings.themeColor}
          onChange={(mode) => onChange({ ...settings, tab: { ...settings.tab, mode } })}
        />
        <div className="fnaThemeCardBg" style={{ marginTop: 12 }}>
          <SettingItem label="展示图标">
            <ThemeSwitch
              checked={settings.tab.showIcon}
              label="展示图标"
              onChange={(showIcon) => onChange({ ...settings, tab: { ...settings.tab, showIcon } })}
            />
          </SettingItem>
          <SettingItem label="加载进度条">
            <ThemeSwitch
              checked={settings.tab.showProgress}
              label="加载进度条"
              onChange={(showProgress) =>
                onChange({ ...settings, tab: { ...settings.tab, showProgress } })
              }
            />
          </SettingItem>
        </div>
      </Section>

      <Section title="外观细节">
        <div className="fnaThemeCardBg">
          <SettingItem label="全局圆角">
            <RadiusSelector
              value={settings.themeRadius}
              onChange={(themeRadius) => onChange({ ...settings, themeRadius })}
            />
          </SettingItem>
          <SettingItem label="卡片样式">
            <CardModeSelector
              value={settings.card.mode}
              color={settings.themeColor}
              onChange={(mode) => onChange({ ...settings, card: { mode } })}
            />
          </SettingItem>
          <SettingItem label="信息色跟随主色">
            <ThemeSwitch
              checked={settings.isInfoFollowPrimary}
              label="信息色跟随主色"
              onChange={(isInfoFollowPrimary) =>
                onChange({
                  ...settings,
                  isInfoFollowPrimary,
                  otherColor: {
                    ...settings.otherColor,
                    info: isInfoFollowPrimary ? settings.themeColor : settings.otherColor.info,
                  },
                })
              }
            />
          </SettingItem>
          <SettingItem label="语义色">
            <div className="fnaSemanticSwatches">
              {(
                [
                  ['success', '成功'],
                  ['warning', '警告'],
                  ['error', '危险'],
                  ['info', '信息'],
                ] as const
              ).map(([key, label]) => (
                <ColorSwatch
                  key={key}
                  value={settings.otherColor[key]}
                  title={label}
                  ariaLabel={label}
                  swatches={SEMANTIC_SWATCHES}
                  disabled={key === 'info' && settings.isInfoFollowPrimary}
                  onChange={(color) =>
                    onChange({
                      ...settings,
                      otherColor: { ...settings.otherColor, [key]: color },
                    })
                  }
                />
              ))}
            </div>
          </SettingItem>
        </div>
      </Section>

      <Section title="偏好">
        <div className="fnaThemeCardBg">
          <SettingItem label="全局尺寸">
            <ThemeSelect
              value={settings.size}
              options={[
                { label: '默认', value: 'default' },
                { label: '大', value: 'large' },
                { label: '小', value: 'small' },
              ]}
              onChange={(size) => onChange({ ...settings, size: size as FnaSize })}
            />
          </SettingItem>
          <SettingItem label="灰色模式">
            <ThemeSwitch
              checked={settings.grayscale}
              label="灰色模式"
              onChange={(grayscale) => onChange({ ...settings, grayscale })}
            />
          </SettingItem>
          <SettingItem label="色弱模式">
            <ThemeSwitch
              checked={settings.colourWeakness}
              label="色弱模式"
              onChange={(colourWeakness) => onChange({ ...settings, colourWeakness })}
            />
          </SettingItem>
          <SettingItem label="显示水印">
            <ThemeSwitch
              checked={settings.watermark.visible}
              label="显示水印"
              onChange={(visible) => onChange({ ...settings, watermark: { visible } })}
            />
          </SettingItem>
        </div>
      </Section>
    </div>
  );
}

function LayoutPane({
  settings,
  onChange,
}: {
  settings: FnaShellSettings;
  onChange: (next: FnaShellSettings) => void;
}) {
  return (
    <div className="fnaThemeFont">
      <Section title="布局模式">
        <LayoutModeCard
          value={settings.layout.mode}
          color={settings.themeColor}
          onChange={(mode) => onChange({ ...settings, layout: { ...settings.layout, mode } })}
        />
      </Section>

      <Section title="顶栏">
        <div className="fnaThemeCardBg">
          <SettingItem label="显示面包屑">
            <ThemeSwitch
              checked={settings.header.breadcrumb.visible}
              label="显示面包屑"
              onChange={(visible) =>
                onChange({
                  ...settings,
                  header: { ...settings.header, breadcrumb: { ...settings.header.breadcrumb, visible } },
                })
              }
            />
          </SettingItem>
          <SettingItem label="显示面包屑图标">
            <ThemeSwitch
              checked={settings.header.breadcrumb.showIcon}
              label="显示面包屑图标"
              disabled={!settings.header.breadcrumb.visible}
              onChange={(showIcon) =>
                onChange({
                  ...settings,
                  header: { ...settings.header, breadcrumb: { ...settings.header.breadcrumb, showIcon } },
                })
              }
            />
          </SettingItem>
          <SettingItem label="显示刷新按钮">
            <ThemeSwitch
              checked={settings.header.refresh.visible}
              label="显示刷新按钮"
              onChange={(visible) =>
                onChange({ ...settings, header: { ...settings.header, refresh: { visible } } })
              }
            />
          </SettingItem>
          <SettingItem label="显示搜索按钮">
            <ThemeSwitch
              checked={settings.header.search.visible}
              label="显示搜索按钮"
              onChange={(visible) =>
                onChange({ ...settings, header: { ...settings.header, search: { visible } } })
              }
            />
          </SettingItem>
          <SettingItem label="显示折叠按钮">
            <ThemeSwitch
              checked={settings.header.collapseButton.visible}
              label="显示折叠按钮"
              onChange={(visible) =>
                onChange({ ...settings, header: { ...settings.header, collapseButton: { visible } } })
              }
            />
          </SettingItem>
          <SettingItem
            label="顶栏背景"
            suffix={<span className="fnaDrawerHintInline">留空跟随主题</span>}
          >
            <ColorSwatch
              value={settings.header.bg}
              ariaLabel="顶栏背景"
              showValue
              clearable
              placeholder="默认"
              swatches={THEME_PRESET_COLORS.map((item) => item.color)}
              onChange={(bg) => onChange({ ...settings, header: { ...settings.header, bg } })}
            />
          </SettingItem>
          <SettingItem label="顶栏阴影">
            <ThemeSelect
              value={settings.header.shadow}
              options={shadowOptions}
              placement="top"
              onChange={(shadow) =>
                onChange({ ...settings, header: { ...settings.header, shadow: shadow as FnaShadow } })
              }
            />
          </SettingItem>
          <SettingItem label="标签栏背景">
            <ColorSwatch
              value={settings.tab.bg}
              ariaLabel="标签栏背景"
              showValue
              clearable
              placeholder="默认"
              swatches={THEME_PRESET_COLORS.map((item) => item.color)}
              onChange={(bg) => onChange({ ...settings, tab: { ...settings.tab, bg } })}
            />
          </SettingItem>
          <SettingItem label="标签栏阴影">
            <ThemeSelect
              value={settings.tab.shadow}
              options={shadowOptions}
              placement="top"
              onChange={(shadow) =>
                onChange({ ...settings, tab: { ...settings.tab, shadow: shadow as FnaShadow } })
              }
            />
          </SettingItem>
          <div className="fnaDrawerHintRow">
            <Info size={14} />
            <span>暗色模式下将基于以上配色自动推导深色版本，无需单独设置</span>
          </div>
        </div>
      </Section>

      <Section title="界面">
        <div className="fnaThemeCardBg">
          <SettingItem label="显示标签页">
            <ThemeSwitch
              checked={settings.tab.visible}
              label="显示标签页"
              onChange={(visible) => onChange({ ...settings, tab: { ...settings.tab, visible } })}
            />
          </SettingItem>
          <SettingItem label="页面切换动画">
            <ThemeSelect
              value={settings.page.transition}
              options={[
                { label: '淡入淡出', value: 'fade' },
                { label: '滑动', value: 'slide' },
                { label: '缩放', value: 'zoom' },
                { label: '无动画', value: 'none' },
              ]}
              placement="top"
              onChange={(transition) =>
                onChange({ ...settings, page: { transition: transition as FnaPageTransition } })
              }
            />
          </SettingItem>
        </div>
      </Section>

      <Section title="侧栏尺寸">
        <div className="fnaThemeCardBg">
          <SettingItem label="展开宽度">
            <NumberField
              value={settings.layout.sideWidth}
              min={150}
              max={400}
              step={10}
              onChange={(sideWidth) => onChange({ ...settings, layout: { ...settings.layout, sideWidth } })}
            />
          </SettingItem>
          <SettingItem label="收缩宽度">
            <NumberField
              value={settings.layout.sideCollapsedWidth}
              min={60}
              max={100}
              onChange={(sideCollapsedWidth) =>
                onChange({ ...settings, layout: { ...settings.layout, sideCollapsedWidth } })
              }
            />
          </SettingItem>
          <SettingItem label="菜单项高度">
            <NumberField
              value={settings.layout.sideItemHeight}
              min={30}
              max={50}
              onChange={(sideItemHeight) =>
                onChange({ ...settings, layout: { ...settings.layout, sideItemHeight } })
              }
            />
          </SettingItem>
        </div>
      </Section>
    </div>
  );
}

function PresetsPane({
  settings,
  onChange,
  onConfirm,
}: {
  settings: FnaShellSettings;
  onChange: (next: FnaShellSettings) => void;
  onConfirm: (value: { title: string; message: string; onConfirm: () => void }) => void;
}) {
  const [customPresets, setCustomPresets] = useState(loadCustomPresets);
  const [promptOpen, setPromptOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function applyPreset(preset: FnaThemePreset) {
    onChange(applyPresetToSettings(preset, settings));
  }

  function handleExport() {
    const data = JSON.stringify(exportCurrentPreset(settings, 'fna-theme'), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fna-theme-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showFnaMessage.success('配置已导出');
  }

  function handleImport(file: File | undefined) {
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const preset = parseImportedPreset(String(reader.result ?? ''));
      if (!preset?.theme) {
        showFnaMessage.warning('配置文件不兼容或为空');
        return;
      }
      onChange(applyPresetToSettings(preset, settings));
      showFnaMessage.success('配置已导入');
    };
    reader.readAsText(file);
  }

  return (
    <div className="fnaThemeFont">
      <Section title="内置预设">
        <div className="fnaPresetGrid">
          {BUILTIN_PRESETS.map((preset) => (
            <PresetCard key={preset.name} preset={preset} settings={settings} onApply={() => applyPreset(preset)} />
          ))}
        </div>
      </Section>

      <Section title="我的预设">
        {customPresets.length ? (
          <div className="fnaPresetGrid" style={{ marginBottom: 16 }}>
            {customPresets.map((preset) => (
              <PresetCard
                key={preset.name}
                preset={preset}
                settings={settings}
                onApply={() => applyPreset(preset)}
                onRemove={() => {
                  onConfirm({
                    title: '删除预设',
                    message: `确定删除预设「${preset.name}」吗？`,
                    onConfirm: () => {
                      setCustomPresets(removeCustomPreset(preset.name));
                      showFnaMessage.success('预设已删除');
                    },
                  });
                }}
              />
            ))}
          </div>
        ) : (
          <div className="fnaThemeCardBg fnaPresetEmpty">暂无自定义预设，点击下方「保存当前为预设」</div>
        )}
        <button
          type="button"
          className="elButton elButtonPrimary fnaDrawerFullBtn"
          onClick={() => setPromptOpen(true)}
        >
          保存当前为预设
        </button>
        {promptOpen ? (
          <PromptDialog
            title="保存当前为预设"
            placeholder="请输入预设名称"
            onCancel={() => setPromptOpen(false)}
            onConfirm={(name) => {
              setCustomPresets(addCustomPreset(exportCurrentPreset(settings, name)));
              setPromptOpen(false);
              showFnaMessage.success('预设已保存');
            }}
          />
        ) : null}
      </Section>

      <Section title="导入导出">
        <div className="fnaThemeCardBg fnaPresetImportRow">
          <button type="button" className="elButton fnaDrawerFlexBtn" onClick={handleExport}>
            导出当前配置
          </button>
          <button type="button" className="elButton fnaDrawerFlexBtn" onClick={() => fileRef.current?.click()}>
            导入配置
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            hidden
            onChange={(event) => {
              handleImport(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>
        <p className="fnaDrawerHint" style={{ marginTop: 12 }}>
          导出当前完整配置（主题 / 布局 / 顶栏 / 界面），可跨账号迁移；
        </p>
      </Section>
    </div>
  );
}

function GeneralPane({
  settings,
  onReset,
}: {
  settings: FnaShellSettings;
  onReset: () => void;
}) {
  const env = useMemo(() => {
    if (typeof navigator === 'undefined') {
      return { browser: 'Unknown', screen: '' };
    }
    const userAgent = navigator.userAgent;
    const browser = userAgent.includes('Edg')
      ? 'Edge'
      : userAgent.includes('Chrome')
        ? 'Chrome'
        : userAgent.includes('Firefox')
          ? 'Firefox'
          : userAgent.includes('Safari')
            ? 'Safari'
            : 'Unknown';
    return {
      browser,
      screen: `${window.screen.width}×${window.screen.height}`,
    };
  }, []);

  return (
    <div className="fnaThemeFont">
      <Section title="系统信息">
        <div className="fnaThemeCardBg">
          <div className="fnaInfoGrid">
            <InfoCell label="版本" value="v0.1.0" />
            <InfoCell label="前端框架" value="Next.js" />
            <InfoCell label="UI 组件库" value="React" />
            <InfoCell label="构建工具" value="Turbopack" />
            <InfoCell label="浏览器" value={env.browser} />
            <InfoCell label="屏幕分辨率" value={env.screen} />
          </div>
        </div>
      </Section>

      <Section title="配置管理">
        <div className="fnaThemeCardBg">
          <div className="fnaThemeCardWhite fnaResetCard">
            <div className="fnaResetCardCopy">
              <div className="fnaResetIcon" aria-hidden="true">
                🔄
              </div>
              <div>
                <h4>重置配置</h4>
                <p>将所有设置恢复为默认值（导入/导出已迁移至「预设」）</p>
              </div>
            </div>
            <button type="button" className="elButton elButtonDanger" onClick={onReset}>
              重置配置
            </button>
          </div>
        </div>
      </Section>

      <Section title="关于项目">
        <div className="fnaThemeCardBg">
          <div className="fnaAboutRow">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/fna-logo.png" alt="" className="fnaAboutLogo" />
            <div>
              <h4>FNA</h4>
              <p>Fiber + Next + Admin 管理台（MSFront），提供权限、菜单、主题与运维能力。</p>
              <div className="fnaAboutLinks">
                <a href="https://github.com/flipped-aurora/gin-vue-admin" target="_blank" rel="noreferrer" style={{ color: settings.themeColor }}>
                  参考仓库
                </a>
                <span>·</span>
                <a href="https://www.gin-vue-admin.com/" target="_blank" rel="noreferrer" style={{ color: settings.themeColor }}>
                  参考文档
                </a>
              </div>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="fnaThemeBlock">
      <div className="fnaThemeSectionHeader">
        <span className="fnaThemeSectionTitle">{title}</span>
      </div>
      {children}
    </div>
  );
}

function SettingItem({
  label,
  suffix,
  children,
}: {
  label: string;
  suffix?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="fnaThemeSettingItem">
      <div className="fnaThemeSettingLabelWrap">
        <span className="fnaThemeSettingLabel">{label}</span>
        {suffix}
      </div>
      <div className="fnaThemeSettingControl">{children}</div>
    </div>
  );
}

function ThemeSwitch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={checked ? 'fnaSwitch is-on' : 'fnaSwitch'}
      aria-label={label}
      aria-pressed={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="fnaSwitchCore" />
    </button>
  );
}

function ThemeSelect({
  value,
  options,
  onChange,
  minWidth = 120,
  placement = 'bottom',
}: {
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
  minWidth?: number;
  placement?: 'top' | 'bottom';
}) {
  return (
    <AdminSelect
      value={value}
      options={options}
      minWidth={minWidth}
      placement={placement}
      onChange={onChange}
    />
  );
}

function NumberField({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      className="fnaThemeNumber"
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

function ColorSwatch({
  value,
  title,
  ariaLabel,
  swatches = [],
  showValue = false,
  clearable = false,
  placeholder = '默认',
  disabled = false,
  onChange,
}: {
  value: string;
  title?: string;
  ariaLabel?: string;
  swatches?: readonly string[];
  showValue?: boolean;
  clearable?: boolean;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const nativeRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const hex = value ? normalizeHexColor(value) : '';

  function placePopover() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const width = 240;
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    const top = rect.bottom + 6;
    setPos({ top, left });
  }

  function toggleOpen() {
    if (disabled) {
      return;
    }
    if (open) {
      setOpen(false);
      return;
    }
    placePopover();
    setOpen(true);
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    function onDismiss() {
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('scroll', onDismiss, true);
    window.addEventListener('resize', onDismiss);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('scroll', onDismiss, true);
      window.removeEventListener('resize', onDismiss);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={title}
        aria-label={ariaLabel || title || placeholder}
        aria-expanded={open}
        disabled={disabled}
        className={`fnaColorSwatch${showValue ? ' is-value' : ''}${open ? ' is-open' : ''}`}
        onClick={toggleOpen}
      >
        <span className="fnaColorSwatchChip">
          <span style={{ backgroundColor: value || 'transparent' }} />
        </span>
        {showValue ? <em>{value || placeholder}</em> : null}
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popoverRef}
              className="fnaColorPopover"
              style={{ top: pos.top, left: pos.left }}
            >
              <button
                type="button"
                className="fnaColorPopoverPreview"
                style={{ backgroundColor: value || '#ffffff' }}
                aria-label="打开系统取色器"
                onClick={() => nativeRef.current?.click()}
              />
              <input
                ref={nativeRef}
                type="color"
                className="fnaColorNative"
                value={hex || '#ffffff'}
                onChange={(event) => onChange(event.target.value)}
              />
              <input
                className="fnaColorPopoverHex"
                value={value}
                placeholder={placeholder}
                spellCheck={false}
                onChange={(event) => onChange(event.target.value)}
              />
              {swatches.length > 0 ? (
                <div className="fnaColorPopoverSwatches">
                  {swatches.map((color) => {
                    const active = hex.toLowerCase() === color.toLowerCase();
                    return (
                      <button
                        key={color}
                        type="button"
                        className={active ? 'is-active' : undefined}
                        style={{ backgroundColor: color }}
                        aria-label={color}
                        onClick={() => onChange(color)}
                      />
                    );
                  })}
                </div>
              ) : null}
              {clearable ? (
                <button type="button" className="fnaColorPopoverClear" onClick={() => onChange('')}>
                  清空（{placeholder}）
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function ThemeModeSelector({
  value,
  color,
  onChange,
}: {
  value: FnaThemeScheme;
  color: string;
  onChange: (value: FnaThemeScheme) => void;
}) {
  const modes = [
    { value: 'light' as const, label: '浅色', icon: Sun },
    { value: 'dark' as const, label: '深色', icon: Moon },
    { value: 'auto' as const, label: '跟随系统', icon: Monitor },
  ];
  return (
    <div className="fnaThemeModeSelectorWrap">
      <div className="fnaThemeModeSelector">
        {modes.map((mode) => {
          const active = value === mode.value;
          const Icon = mode.icon;
          return (
            <button
              key={mode.value}
              type="button"
              className={active ? 'fnaThemeModeItem is-active' : 'fnaThemeModeItem'}
              style={active ? { backgroundColor: color } : undefined}
              onClick={() => onChange(mode.value)}
            >
              <Icon size={16} strokeWidth={2} aria-hidden />
              <span>{mode.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ThemeColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="fnaThemeCardBg fnaThemeColorRow">
      {THEME_PRESET_COLORS.map((item) => {
        const active = value.toLowerCase() === item.color.toLowerCase();
        return (
          <button
            key={item.color}
            type="button"
            title={item.name}
            className={active ? 'fnaColorDot is-active' : 'fnaColorDot'}
            style={{ backgroundColor: item.color, ['--tw-ring-color' as string]: item.color }}
            onClick={() => onChange(item.color)}
          >
            {active ? <Check size={12} strokeWidth={2.75} /> : null}
          </button>
        );
      })}
      <span className="fnaColorDivider" />
      <ColorSwatch
        value={value}
        ariaLabel="自定义主题色"
        swatches={THEME_PRESET_COLORS.map((item) => item.color)}
        onChange={onChange}
      />
      <code>{value}</code>
    </div>
  );
}

function MenuThemeSelector({
  value,
  color,
  onChange,
}: {
  value: FnaMenuTheme;
  color: string;
  onChange: (value: FnaMenuTheme) => void;
}) {
  const items: Array<{
    value: FnaMenuTheme;
    previewSide: string;
    previewMain: string;
    previewActive: string;
    previewSideText: string;
  }> = [
    {
      value: 'design',
      previewSide: '#ffffff',
      previewMain: '#f5f6f8',
      previewActive: `rgba(${hexToRgbChannels(color)}, 0.15)`,
      previewSideText: '#94a3b8',
    },
    {
      value: 'light',
      previewSide: '#ffffff',
      previewMain: '#f5f6f8',
      previewActive: color,
      previewSideText: '#94a3b8',
    },
    {
      value: 'group',
      previewSide: '#ffffff',
      previewMain: '#f5f6f8',
      previewActive: `rgba(${hexToRgbChannels(color)}, 0.15)`,
      previewSideText: '#64748b',
    },
  ];

  return (
    <div className="fnaPreviewGrid">
      {items.map((item) => {
        const active = value === item.value;
        return (
          <button
            key={item.value}
            type="button"
            className="fnaPreviewCard"
            style={active ? { borderColor: color, boxShadow: `0 0 0 1px ${color}` } : undefined}
            onClick={() => onChange(item.value)}
          >
            <div className="fnaMiniLayout">
              <div className="fnaMiniSide" style={{ background: item.previewSide }}>
                <span style={{ background: item.previewActive }} />
                <span style={{ background: item.previewSideText, opacity: 0.4 }} />
              </div>
              <div className="fnaMiniMain" style={{ background: item.previewMain }} />
            </div>
            {active ? <Check size={14} className="fnaPreviewCheck" style={{ color }} /> : null}
          </button>
        );
      })}
    </div>
  );
}

function TabModeSelector({
  value,
  color,
  onChange,
}: {
  value: FnaTabMode;
  color: string;
  onChange: (value: FnaTabMode) => void;
}) {
  const primarySoft = `rgba(${hexToRgbChannels(color)}, 0.15)`;
  const modes: Array<{ value: FnaTabMode; label: string }> = [
    { value: 'button', label: '默认' },
    { value: 'chrome', label: 'Chrome' },
    { value: 'slider', label: '指示条' },
  ];

  return (
    <div className="fnaPreviewGrid">
      {modes.map((item) => {
        const active = value === item.value;
        return (
          <button
            key={item.value}
            type="button"
            className="fnaPreviewCard fnaTabPreviewCard"
            style={active ? { borderColor: color, boxShadow: `0 0 0 1px ${color}` } : undefined}
            onClick={() => onChange(item.value)}
          >
            {item.value === 'button' ? (
              <div className="fnaTabPreview fnaTabPreviewButton">
                <span style={{ backgroundColor: primarySoft }} />
                <i />
                <span />
                <i />
                <span />
              </div>
            ) : null}
            {item.value === 'chrome' ? (
              <div className="fnaTabPreview fnaTabPreviewChrome">
                <span />
                <span style={{ backgroundColor: primarySoft }} />
                <span />
              </div>
            ) : null}
            {item.value === 'slider' ? (
              <div className="fnaTabPreview fnaTabPreviewSlider">
                <span>
                  <em />
                </span>
                <span className="is-active" style={{ borderColor: color, backgroundColor: primarySoft }}>
                  <em style={{ backgroundColor: color }} />
                </span>
                <span>
                  <em className="is-short" />
                </span>
              </div>
            ) : null}
            <em style={active ? { color } : undefined}>{item.label}</em>
            {active ? <Check size={14} className="fnaPreviewCheck" style={{ color }} /> : null}
          </button>
        );
      })}
    </div>
  );
}

function LayoutModeCard({
  value,
  color,
  onChange,
}: {
  value: FnaLayoutMode;
  color: string;
  onChange: (value: FnaLayoutMode) => void;
}) {
  const lighter = addOpacityToColor(color, 0.7);
  const lightest = addOpacityToColor(color, 0.4);
  const layouts: Array<{
    value: FnaLayoutMode;
    label: string;
    description: string;
    showSidebar: boolean;
    showHeader: boolean;
    topLogo?: boolean;
    column?: boolean;
    primary: 'sidebar' | 'header';
    secondary?: 'sidebar' | 'header';
  }> = [
    { value: 'normal', label: '经典布局', description: '左侧导航，顶部标题栏', showSidebar: true, showHeader: true, primary: 'sidebar' },
    { value: 'head', label: '顶部导航', description: '水平导航栏布局', showSidebar: false, showHeader: true, column: true, primary: 'header' },
    { value: 'combination', label: '混合布局', description: '多级导航组合模式', showSidebar: true, showHeader: true, primary: 'header', secondary: 'sidebar' },
    { value: 'sidebar', label: '侧栏常驻', description: '二级菜单会始终打开', showSidebar: true, showHeader: true, primary: 'sidebar' },
    { value: 'vertical', label: '通栏侧边', description: '侧栏通顶，Logo 置顶', showSidebar: true, showHeader: true, topLogo: true, primary: 'sidebar' },
  ];

  function tone(role: 'sidebar' | 'header', layout: (typeof layouts)[number]) {
    if (layout.primary === role) {
      return { backgroundColor: color, opacity: 0.95 };
    }
    if (layout.secondary === role) {
      return { backgroundColor: lighter, opacity: 0.85 };
    }
    return { backgroundColor: lightest, opacity: 0.6 };
  }

  return (
    <div className="fnaLayoutGrid">
      {layouts.map((layout) => {
        const active = value === layout.value;
        return (
          <button
            key={layout.value}
            type="button"
            className="fnaLayoutCard"
            style={active ? { borderColor: color, boxShadow: `0 0 0 1px ${color}` } : undefined}
            onClick={() => onChange(layout.value)}
          >
            <div className={layout.column ? 'fnaLayoutMini is-column' : 'fnaLayoutMini'}>
              {layout.showSidebar ? (
                <div className="fnaLayoutMiniSide" style={tone('sidebar', layout)}>
                  {layout.topLogo ? <i /> : null}
                </div>
              ) : null}
              <div className="fnaLayoutMiniBody">
                {layout.showHeader ? <div className="fnaLayoutMiniHeader" style={tone('header', layout)} /> : null}
                <div className="fnaLayoutMiniContent" style={{ backgroundColor: lightest, opacity: 0.5 }} />
              </div>
            </div>
            <strong style={active ? { color } : undefined}>{layout.label}</strong>
            <span>{layout.description}</span>
          </button>
        );
      })}
    </div>
  );
}

function RadiusSelector({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const percent = Math.min(100, Math.max(0, value * 100));
  const marks = [
    { value: 0, label: '0' },
    { value: 0.5, label: '0.5' },
    { value: 1, label: '1' },
  ];

  return (
    <div className="fnaRadiusSelector">
      <div className="fnaSlider">
        <div className="fnaSliderRow">
          <div className="fnaSliderTrack">
            <div className="fnaSliderRange" style={{ width: `${percent}%` }} />
          </div>
          <input
            type="range"
            className="fnaSliderInput"
            min={0}
            max={1}
            step={0.05}
            value={value}
            aria-label="全局圆角"
            onChange={(event) => onChange(Number(event.target.value))}
          />
        </div>
        <div className="fnaSliderMarks">
          {marks.map((mark) => (
            <span key={mark.value} style={{ left: `${mark.value * 100}%` }}>
              {mark.label}
            </span>
          ))}
        </div>
      </div>
      <span>{Number.parseFloat(value.toFixed(2))}rem</span>
    </div>
  );
}

function CardModeSelector({
  value,
  color,
  onChange,
}: {
  value: FnaCardMode;
  color: string;
  onChange: (value: FnaCardMode) => void;
}) {
  return (
    <div className="fnaCardModeSelector">
      {(
        [
          ['border', '边框'],
          ['shadow', '阴影'],
        ] as const
      ).map(([mode, label]) => {
        const active = value === mode;
        return (
          <button
            key={mode}
            type="button"
            className={active ? 'is-active' : undefined}
            style={active ? { backgroundColor: color, color: '#fff' } : undefined}
            onClick={() => onChange(mode)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function PresetCard({
  preset,
  settings,
  onApply,
  onRemove,
}: {
  preset: FnaThemePreset;
  settings: FnaShellSettings;
  onApply: () => void;
  onRemove?: () => void;
}) {
  const theme = applyPresetToSettings(preset, settings);
  const sideBg = theme.menu.darkSider ? '#1e293b' : '#ffffff';
  const mainBg = theme.themeScheme === 'dark' ? '#0f172a' : '#f5f6f8';

  return (
    <button type="button" className="fnaPresetCard" onClick={onApply}>
      <div className="fnaPresetPreview">
        <div style={{ background: sideBg }} />
        <div style={{ background: mainBg }}>
          <span style={{ background: theme.themeColor }} />
          <div>
            <i style={{ background: theme.themeColor }} />
            <i style={{ background: theme.otherColor.success }} />
            <i style={{ background: theme.otherColor.warning }} />
            <i style={{ background: theme.otherColor.error }} />
          </div>
        </div>
      </div>
      <div className="fnaPresetMeta">
        <span>{preset.name}</span>
        {preset.builtin ? <em>内置</em> : null}
      </div>
      {onRemove ? (
        <span
          className="fnaPresetRemove"
          role="button"
          tabIndex={0}
          aria-label="删除预设"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              onRemove();
            }
          }}
        >
          <Trash2 size={14} />
        </span>
      ) : null}
    </button>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="fnaInfoCell">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ConfirmDialog({
  title,
  message,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="adminDialogBackdrop" role="presentation" onClick={onCancel}>
      <div className="adminDialog fnaDialog fnaConfirmDialog" role="alertdialog" onClick={(event) => event.stopPropagation()}>
        <div className="adminDialogHeader">
          <strong>{title}</strong>
        </div>
        <div className="adminDialogBody">
          <p className="fnaConfirmMessage">{message}</p>
        </div>
        <div className="adminDialogFooter">
          <button type="button" className="elButton" onClick={onCancel}>
            取 消
          </button>
          <button type="button" className="elButton elButtonPrimary" onClick={onConfirm}>
            确 定
          </button>
        </div>
      </div>
    </div>
  );
}

function PromptDialog({
  title,
  placeholder,
  onCancel,
  onConfirm,
}: {
  title: string;
  placeholder: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <div className="adminDialogBackdrop" role="presentation" onClick={onCancel}>
      <div className="adminDialog fnaDialog fnaConfirmDialog" role="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="adminDialogHeader">
          <strong>{title}</strong>
        </div>
        <div className="adminDialogBody">
          <input
            className="fnaThemeNumber"
            style={{ width: '100%' }}
            autoFocus
            placeholder={placeholder}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        <div className="adminDialogFooter">
          <button type="button" className="elButton" onClick={onCancel}>
            取 消
          </button>
          <button
            type="button"
            className="elButton elButtonPrimary"
            disabled={!value.trim()}
            onClick={() => onConfirm(value.trim())}
          >
            保 存
          </button>
        </div>
      </div>
    </div>
  );
}

const shadowOptions = [
  { label: '无', value: 'none' },
  { label: '小', value: 'sm' },
  { label: '中', value: 'md' },
  { label: '大', value: 'lg' },
];

function normalizeHexColor(value: string) {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    return `#${hex[1]}`;
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value);
  if (!rgb) {
    return '#ffffff';
  }
  const toHex = (part: string) => Number(part).toString(16).padStart(2, '0');
  return `#${toHex(rgb[1])}${toHex(rgb[2])}${toHex(rgb[3])}`;
}
