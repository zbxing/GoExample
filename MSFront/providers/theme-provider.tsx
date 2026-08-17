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
import { themeClassMap } from '@/lib/utils/theme';

interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const storageKey = 'msfront:theme';

export function ThemeProvider({ children }: PropsWithChildren) {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') {
      return siteConfig.defaultTheme;
    }

    const storedValue = window.localStorage.getItem(storageKey) as ThemeMode | null;
    return storedValue && siteConfig.themes.includes(storedValue)
      ? storedValue
      : siteConfig.defaultTheme;
  });
  const [systemTheme, setSystemTheme] = useState<Exclude<ThemeMode, 'system'>>(() =>
    readSystemTheme(),
  );

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
    applyTheme(theme === 'system' ? systemTheme : theme);
  }, [systemTheme, theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme(nextTheme) {
        setThemeState(nextTheme);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(storageKey, nextTheme);
        }
      },
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

function applyTheme(theme: Exclude<ThemeMode, 'system'>) {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;

  for (const className of Object.values(themeClassMap)) {
    root.classList.remove(className);
  }

  root.classList.add(themeClassMap[theme]);
}

function readSystemTheme(): Exclude<ThemeMode, 'system'> {
  if (typeof window === 'undefined') {
    return 'gva';
  }

  return resolveSystemTheme();
}

function resolveSystemTheme(
  mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)'),
): Exclude<ThemeMode, 'system'> {
  if (mediaQueryList.matches) {
    return 'graphite';
  }

  return 'gva';
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider.');
  }

  return context;
}
