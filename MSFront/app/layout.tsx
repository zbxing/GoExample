import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppProviders } from '@/providers/app-providers';
import { siteConfig } from '@/lib/config/site';
import { themeClassMap } from '@/lib/utils/theme';
import './globals.css';
import './gva-parity.css';

export const metadata: Metadata = {
  title: `${siteConfig.name} | ${siteConfig.title}`,
  description: siteConfig.description,
};

const initialThemeClass =
  themeClassMap[
    siteConfig.defaultTheme === 'system' ? 'gva' : siteConfig.defaultTheme
  ] ?? themeClassMap.gva;

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang={siteConfig.defaultLocale} className={initialThemeClass}>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
