'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { getDictionary, isLocaleCode, translate } from '@/lib/i18n';
import type { LocaleCode } from '@/lib/types/management';
import { siteConfig } from '@/lib/config/site';

interface LocaleContextValue {
  locale: LocaleCode;
  setLocale: (locale: LocaleCode) => void;
  t: (path: string, variables?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

const storageKey = 'msfront:locale';

export function LocaleProvider({ children }: PropsWithChildren) {
  const [locale, setLocaleState] = useState<LocaleCode>(() => {
    if (typeof window === 'undefined') {
      return siteConfig.defaultLocale;
    }

    const storedValue = window.localStorage.getItem(storageKey);
    return storedValue && isLocaleCode(storedValue) ? storedValue : siteConfig.defaultLocale;
  });

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<LocaleContextValue>(() => {
    const dictionary = getDictionary(locale);

    return {
      locale,
      setLocale(nextLocale) {
        setLocaleState(nextLocale);
        window.localStorage.setItem(storageKey, nextLocale);
        document.documentElement.lang = nextLocale;
      },
      t(path, variables) {
        return translate(dictionary, path, variables);
      },
    };
  }, [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);

  if (!context) {
    throw new Error('useLocale must be used within LocaleProvider.');
  }

  return context;
}
