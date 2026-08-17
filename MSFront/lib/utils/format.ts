import type { LocaleCode, ProjectStatus, ProjectEnvironment } from '@/lib/types/management';

type DetailPart = string | number | null | undefined;

export function formatNumber(value: number, locale: LocaleCode): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatPercent(value: number, locale: LocaleCode): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: value < 1 ? 2 : 1,
    maximumFractionDigits: value < 1 ? 2 : 1,
  }).format(value);
}

export function formatDateTime(value: string, locale: LocaleCode): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatDecimal(value: number, locale: LocaleCode): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    minimumFractionDigits: value > 0 && value < 1 ? 1 : 0,
  }).format(value);
}

export function joinDetails(parts: DetailPart[]): string {
  return parts
    .map((part) => `${part ?? ''}`.trim())
    .filter(Boolean)
    .join(' / ');
}

export function humanizeIdentifier(value: string): string {
  return `${value}`
    .replace(/[_:.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function statusTone(status: ProjectStatus): string {
  if (status === 'healthy') {
    return 'var(--tone-success)';
  }

  if (status === 'warning') {
    return 'var(--tone-warning)';
  }

  return 'var(--tone-danger)';
}

export function environmentTone(environment: ProjectEnvironment): string {
  if (environment === 'production') {
    return 'var(--tone-success)';
  }

  if (environment === 'staging') {
    return 'var(--tone-warning)';
  }

  return 'var(--tone-info)';
}
