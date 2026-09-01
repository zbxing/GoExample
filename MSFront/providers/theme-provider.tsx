'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import type { ThemeMode } from '@/lib/types/management';
import { siteConfig } from '@/lib/config/site';
import {
  applyFnaShellCss,
  hydrateFnaShellSettings,
  readFnaShellSettings,
} from '@/lib/utils/fna-shell-settings';
import { THEME_STORAGE_KEY, themeClassMap, normalizeStoredThemeMode } from '@/lib/utils/theme';

interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  /** 是否已完成客户端主题同步（避免顶栏图标等 hydration 不一致） */
  themeReady: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  // 服务端 / 客户端首屏必须同一默认值，禁止在 useState 初始化时读 localStorage
  const [theme, setThemeState] = useState<ThemeMode>(siteConfig.defaultTheme);
  const [systemTheme, setSystemTheme] = useState<Exclude<ThemeMode, 'system'>>('fna');
  const [themeReady, setThemeReady] = useState(false);

  useEffect(() => {
    const storedValue = window.localStorage.getItem(THEME_STORAGE_KEY);
    const normalized = normalizeStoredThemeMode(storedValue, siteConfig.themes);
    if (normalized) {
      if (storedValue !== normalized) {
        window.localStorage.setItem(THEME_STORAGE_KEY, normalized);
      }
      setThemeState(normalized);
    }
    setSystemTheme(resolveSystemTheme());
    setThemeReady(true);
  }, []);

  useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined') {
      return;
    }

    const mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      setSystemTheme(resolveSystemTheme(mediaQueryList));
    };

    handleChange();

    if (typeof mediaQueryList.addEventListener === 'function') {
      mediaQueryList.addEventListener('change', handleChange);
      return () => {
        mediaQueryList.removeEventListener('change', handleChange);
      };
    }

    mediaQueryList.addListener(handleChange);
    return () => {
      mediaQueryList.removeListener(handleChange);
    };
  }, [theme]);

  useEffect(() => {
    if (!themeReady) {
      return;
    }
    // 先同步 html.dark，再写 Element 主色阶；登录页也依赖这套通用配置
    applyTheme(theme === 'system' ? systemTheme : theme);
    hydrateFnaShellSettings();
    applyFnaShellCss(readFnaShellSettings());
  }, [systemTheme, theme, themeReady]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      themeReady,
      setTheme(nextTheme) {
        setThemeState(nextTheme);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        }
      },
    }),
    [theme, themeReady],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * 管理台布局 CSS 绑定在 `.theme-fna` 上。
 * graphite（暗色）必须保留 theme-fna，另加 html.dark；不能换成 theme-graphite，否则侧栏/顶栏样式全丢。
 */
export function applyTheme(theme: Exclude<ThemeMode, 'system'>) {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;

  for (const className of Object.values(themeClassMap)) {
    root.classList.remove(className);
  }
  root.classList.remove('dark');

  if (theme === 'graphite') {
    root.classList.add(themeClassMap.fna);
    root.classList.add('dark');
    return;
  }

  if (theme === 'fna') {
    root.classList.add(themeClassMap.fna);
    return;
  }

  root.classList.add(themeClassMap[theme]);
}

function resolveSystemTheme(
  mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)'),
): Exclude<ThemeMode, 'system'> {
  if (mediaQueryList.matches) {
    return 'graphite';
  }

  return 'fna';
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider.');
  }

  return context;
}
