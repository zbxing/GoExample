'use client';

import { useMemo } from 'react';
import type {
  SecurityGovernanceView,
  TimelineItem,
} from '@/lib/types/management';
import {
  filterSecurityApiKeys,
  filterSecurityAuditEvents,
  filterSecuritySessions,
  filterSecurityUsers,
  type SecurityFocusFilter,
  type SecurityStatusFilter,
} from '@/lib/utils/security-filters';
import {
  buildSecurityAuditTimelineItems,
  buildSecurityHeroPresentationModel,
} from '@/lib/utils/security-surface';
import { useSecurityFiltersController } from '@/lib/utils/use-security-filters-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseSecurityPageSurfaceControllerOptions {
  pathname: string;
  governance: SecurityGovernanceView;
  locale: 'zh-CN' | 'en-US';
  t: TranslationFn;
  initialFocus?: SecurityFocusFilter;
  initialStatus?: SecurityStatusFilter;
  initialRole?: string;
  initialSearch?: string;
  clearFeedback: () => void;
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
}

export function useSecurityPageSurfaceController({
  pathname,
  governance,
  locale,
  t,
  initialFocus = 'all',
  initialStatus = 'all',
  initialRole = '',
  initialSearch = '',
  clearFeedback,
  showError,
  showSuccess,
}: UseSecurityPageSurfaceControllerOptions) {
  const roleOptions = useMemo(
    () =>
      Array.from(new Set(governance.roles.map((role) => role.role))).sort((left, right) =>
        left.localeCompare(right),
      ),
    [governance.roles],
  );
  const {
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
  } = useSecurityFiltersController({
    pathname,
    availableRoles: roleOptions,
    initialFocus,
    initialRole,
    initialSearch,
    initialStatus,
    clearFeedback,
    showError,
    showSuccess,
    t,
  });
  const heroPresentation = useMemo(
    () => buildSecurityHeroPresentationModel(governance.summary, governance.source, locale, t),
    [governance.source, governance.summary, locale, t],
  );
  const filteredAuditEvents = useMemo(
    () =>
      filterSecurityAuditEvents(governance.auditEvents, {
        focus,
        search,
      }),
    [focus, governance.auditEvents, search],
  );
  const auditItems = useMemo<TimelineItem[]>(
    () => buildSecurityAuditTimelineItems(filteredAuditEvents),
    [filteredAuditEvents],
  );
  const filteredUsers = useMemo(
    () =>
      filterSecurityUsers(governance.users, {
        focus,
        status: statusFilter,
        role: roleFilter,
        search,
      }),
    [focus, governance.users, roleFilter, search, statusFilter],
  );
  const filteredSessions = useMemo(
    () =>
      filterSecuritySessions(governance.sessions, {
        focus,
        status: statusFilter,
        search,
      }),
    [focus, governance.sessions, search, statusFilter],
  );
  const filteredApiKeys = useMemo(
    () =>
      filterSecurityApiKeys(governance.apiKeys, {
        focus,
        status: statusFilter,
        search,
      }),
    [focus, governance.apiKeys, search, statusFilter],
  );

  return {
    accessNavigationContext,
    auditItems,
    filteredApiKeys,
    filteredAuditEvents,
    filteredSessions,
    filteredUsers,
    focus,
    handleCopyCurrentView,
    handleResetFilters,
    heroPresentation,
    roleFilter,
    roleOptions,
    search,
    setFocus,
    setRoleFilter,
    setSearch,
    setStatusFilter,
    statusFilter,
  };
}
