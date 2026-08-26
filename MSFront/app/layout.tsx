import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppProviders } from '@/providers/app-providers';
import { siteConfig } from '@/lib/config/site';
import { THEME_STORAGE_KEY, themeClassMap } from '@/lib/utils/theme';
import './globals.css';
import './ga-parity.css';
import './ga-dark.css';

export const metadata: Metadata = {
  title: `${siteConfig.name} | ${siteConfig.title}`,
  description: siteConfig.description,
};

const initialThemeClass =
  themeClassMap[
    siteConfig.defaultTheme === 'system' ? 'gva' : siteConfig.defaultTheme
  ] ?? themeClassMap.gva;

/** 在 hydration 前同步 html class，避免暗色主题闪白；graphite 仍保留 theme-gva 布局类 */
const themeBootScript = `
(function(){
  try {
    var key = ${JSON.stringify(THEME_STORAGE_KEY)};
    var map = ${JSON.stringify(themeClassMap)};
    var themes = ${JSON.stringify(siteConfig.themes)};
    var stored = localStorage.getItem(key);
    var theme = (stored && themes.indexOf(stored) !== -1) ? stored : ${JSON.stringify(siteConfig.defaultTheme)};
    if (theme === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'graphite' : 'gva';
    }
    var root = document.documentElement;
    Object.keys(map).forEach(function(k){ root.classList.remove(map[k]); });
    root.classList.remove('dark');
    if (theme === 'graphite') {
      root.classList.add(map.gva);
      root.classList.add('dark');
    } else if (theme === 'gva') {
      root.classList.add(map.gva);
    } else if (map[theme]) {
      root.classList.add(map[theme]);
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang={siteConfig.defaultLocale} className={initialThemeClass} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
