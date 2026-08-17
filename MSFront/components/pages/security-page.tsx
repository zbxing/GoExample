'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  SecurityHeroOverview,
} from '@/components/common/security-governance-surface';
import { SecurityPageLowerContent } from '@/components/pages/security-page-lower-content';
import { useLocale } from '@/providers/locale-provider';
import type { SecurityGovernanceView } from '@/lib/types/management';
import {
  type SecurityFocusFilter,
  type SecurityStatusFilter,
} from '@/lib/utils/security-filters';
import { useFeedback } from '@/lib/utils/use-feedback';
import { useSecurityPageSurfaceController } from '@/lib/utils/use-security-page-surface-controller';

interface SecurityPageProps {
  governance: SecurityGovernanceView;
  initialFocus?: SecurityFocusFilter;
  initialStatus?: SecurityStatusFilter;
  initialRole?: string;
  initialSearch?: string;
}

export function SecurityPage({
  governance,
  initialFocus = 'all',
  initialStatus = 'all',
  initialRole = '',
  initialSearch = '',
}: SecurityPageProps) {
  const { locale, t } = useLocale();
  const pathname = usePathname();
  const [currentGovernance, setCurrentGovernance] = useState<SecurityGovernanceView>(governance);
  const { feedback, clearFeedback, showError, showSuccess } = useFeedback({ durationMs: 4200 });
  const {
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
  } = useSecurityPageSurfaceController({
    pathname,
    governance: currentGovernance,
    locale,
    t,
    initialFocus,
    initialRole,
    initialSearch,
    initialStatus,
    clearFeedback,
    showError,
    showSuccess,
  });

  const workbenchProps = {
    locale,
    t,
    governance: currentGovernance,
    filteredUsers,
    filteredSessions,
    filteredApiKeys,
    auditCount: filteredAuditEvents.length,
    accessNavigationContext,
    focus,
    statusFilter,
    roleFilter,
    search,
    roleOptions,
    feedback,
    onSearchChange: setSearch,
    onFocusChange: setFocus,
    onStatusChange: setStatusFilter,
    onRoleChange: setRoleFilter,
    onCopy: handleCopyCurrentView,
    onReset: handleResetFilters,
  };

  const resultsProps = {
    locale,
    t,
    governance: currentGovernance,
    filteredUsers,
    filteredSessions,
    filteredApiKeys,
    auditItems,
    accessNavigationContext,
    onGovernanceChange: setCurrentGovernance,
    onClearFeedback: clearFeedback,
    onShowError: showError,
    onShowSuccess: showSuccess,
  };

  return (
    <div className="pageStack">
      <SecurityHeroOverview
        eyebrow={t('nav.security')}
        title={t('pages.securityTitle')}
        description={t('pages.securityDescription')}
        metrics={heroPresentation.metrics}
        postureTitle={t('security.postureTitle')}
        postureDescription={heroPresentation.overviewMessage}
        postureSummaryMetrics={heroPresentation.postureSummaryMetrics}
        postureExposureSignals={heroPresentation.postureExposureSignals}
        sourceBadge={heroPresentation.sourceBadge}
        t={t}
      />
      <SecurityPageLowerContent workbenchProps={workbenchProps} resultsProps={resultsProps} />
    </div>
  );
}
