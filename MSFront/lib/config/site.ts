import type { LocaleCode, ProjectStorageDriver, ThemeMode } from '@/lib/types/management';

export const siteConfig = {
  name: 'GoExample',
  title: 'Fiber Operations Console',
  description:
    'A Next.js management console paired with the GoExample Fiber server template.',
  locales: ['zh-CN', 'en-US'] as const satisfies LocaleCode[],
  themes: ['gva', 'system', 'aurora', 'graphite', 'ocean'] as const satisfies ThemeMode[],
  defaultLocale:
    (process.env.NEXT_PUBLIC_MSFRONT_DEFAULT_LOCALE as LocaleCode | undefined) ?? 'zh-CN',
  defaultTheme:
    (process.env.NEXT_PUBLIC_MSFRONT_DEFAULT_THEME as ThemeMode | undefined) ?? 'gva',
  apiBaseUrl: process.env.NEXT_PUBLIC_MSFRONT_API_BASE_URL ?? 'http://localhost:3001',
  enableLiveProbes:
    process.env.NEXT_PUBLIC_MSFRONT_ENABLE_LIVE_PROBES === 'true' ||
    process.env.MSFRONT_ENABLE_LIVE_PROBES === 'true',
  inventoryDocumentPath: 'docs/openapi/openapi.json',
  projectCatalogPath: 'MSFront/data/projects.json',
};

export function resolveConfiguredProjectStorageDriver(): ProjectStorageDriver {
  const configuredValue = `${process.env.MSFRONT_PROJECT_STORAGE_DRIVER ?? 'auto'}`
    .trim()
    .toLowerCase();

  if (
    configuredValue === 'auto' ||
    configuredValue === 'database' ||
    configuredValue === 'file'
  ) {
    return configuredValue;
  }

  return 'auto';
}
