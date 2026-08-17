'use client';

import {
  useMemo,
  useState,
} from 'react';
import type { AccessNavigationContext } from '@/lib/utils/access-navigation';
import { copyTextToClipboard } from '@/lib/utils/clipboard';
import {
  buildSecurityHref,
  resolveSecurityFilterState,
  type SecurityFocusFilter,
  type SecurityFilterState,
  type SecurityStatusFilter,
} from '@/lib/utils/security-filters';
import { useUrlFilterHistory } from '@/lib/utils/use-url-filter-history';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseSecurityFiltersControllerOptions {
  pathname: string;
  availableRoles: readonly string[];
  initialFocus?: SecurityFocusFilter;
  initialStatus?: SecurityStatusFilter;
  initialRole?: string;
  initialSearch?: string;
  clearFeedback: () => void;
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
  t: TranslationFn;
}

export function useSecurityFiltersController({
  pathname,
  availableRoles,
  initialFocus = 'all',
  initialStatus = 'all',
  initialRole = '',
  initialSearch = '',
  clearFeedback,
  showError,
  showSuccess,
  t,
}: UseSecurityFiltersControllerOptions) {
  const initialFilters = resolveSecurityFilterState(
    {
      focus: initialFocus,
      status: initialStatus,
      role: initialRole,
      search: initialSearch,
    },
    availableRoles,
  );
  const [search, setSearch] = useState(initialFilters.search);
  const [focus, setFocus] = useState<SecurityFocusFilter>(initialFilters.focus);
  const [statusFilter, setStatusFilter] = useState<SecurityStatusFilter>(initialFilters.status);
  const [roleFilter, setRoleFilter] = useState<string>(initialFilters.role);
  const currentFilterState = useMemo<SecurityFilterState>(
    () => ({
      focus,
      status: statusFilter,
      role: roleFilter,
      search,
    }),
    [focus, roleFilter, search, statusFilter],
  );
  const currentFilterHref = useMemo(
    () => buildSecurityHref(currentFilterState),
    [currentFilterState],
  );
  const accessNavigationContext = useMemo<AccessNavigationContext>(
    () => ({
      security: currentFilterState,
    }),
    [currentFilterState],
  );

  function syncFiltersFromUrl(nextSearchParams: URLSearchParams) {
    const nextFilters = resolveSecurityFilterState(
      {
        focus: nextSearchParams.get('focus'),
        status: nextSearchParams.get('status'),
        role: nextSearchParams.get('role'),
        search: nextSearchParams.get('search'),
      },
      availableRoles,
    );

    setSearch(nextFilters.search);
    setFocus(nextFilters.focus);
    setStatusFilter(nextFilters.status);
    setRoleFilter(nextFilters.role);
    clearFeedback();
  }

  useUrlFilterHistory({
    pathname,
    currentState: currentFilterState,
    getCurrentHref: () => currentFilterHref,
    syncFromUrl: syncFiltersFromUrl,
    shouldPushHistory: shouldPushSecurityHistory,
  });

  async function handleCopyCurrentView() {
    clearFeedback();

    try {
      await copyTextToClipboard(window.location.href);
      showSuccess(t('security.messages.copyFiltersSuccess'));
    } catch {
      showError(t('security.messages.copyFiltersError'));
    }
  }

  function handleResetFilters() {
    clearFeedback();
    setSearch('');
    setFocus('all');
    setStatusFilter('all');
    setRoleFilter('all');
  }

  return {
    accessNavigationContext,
    focus,
    handleCopyCurrentView,
    handleResetFilters,
    roleFilter,
    search,
    setFocus,
    setRoleFilter,
    setSearch,
    setStatusFilter,
    statusFilter,
  };
}

function shouldPushSecurityHistory(
  previousFilters: SecurityFilterState | null,
  nextFilters: SecurityFilterState,
) {
  if (!previousFilters) {
    return false;
  }

  return (
    previousFilters.focus !== nextFilters.focus ||
    previousFilters.status !== nextFilters.status ||
    previousFilters.role !== nextFilters.role
  );
}
