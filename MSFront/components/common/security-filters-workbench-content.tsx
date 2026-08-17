'use client';

import type { ReactNode } from 'react';
import { ManagementContextStrip } from '@/components/common/management-primitives';
import { SecurityPanelSection } from '@/components/common/security-panel-section';
import {
  SecurityFiltersWorkbenchFiltersContent,
} from '@/components/common/security-filters-workbench-filters-content';
import {
  SecurityFiltersWorkbenchResultsBarContent,
} from '@/components/common/security-filters-workbench-results-bar-content';

interface SecurityWorkbenchControlsProps {
  contextLabel: string;
  contextTags: readonly string[];
  contextActions?: ReactNode;
  filters: ReactNode;
  resultsBar?: ReactNode;
  feedback?: ReactNode;
  className?: string;
}

interface SecurityWorkbenchOption {
  value: string;
  label: string;
}

interface SecurityFiltersWorkbenchProps {
  title: string;
  description: string;
  contextLabel: string;
  contextTags: readonly string[];
  contextActions?: ReactNode;
  searchLabel: string;
  searchPlaceholder: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  focusLabel: string;
  focusValue: string;
  focusOptions: readonly SecurityWorkbenchOption[];
  onFocusChange: (value: string) => void;
  statusLabel: string;
  statusValue: string;
  statusOptions: readonly SecurityWorkbenchOption[];
  onStatusChange: (value: string) => void;
  roleLabel: string;
  roleValue: string;
  roleOptions: readonly SecurityWorkbenchOption[];
  onRoleChange: (value: string) => void;
  summaryTags: readonly string[];
  copyLabel: string;
  onCopy: () => void;
  resetLabel: string;
  onReset: () => void;
  feedback?: ReactNode;
  className?: string;
}

function SecurityWorkbenchControls({
  contextLabel,
  contextTags,
  contextActions,
  filters,
  resultsBar,
  feedback,
  className = 'portfolioWorkbench',
}: SecurityWorkbenchControlsProps) {
  return (
    <div className={className}>
      <ManagementContextStrip
        label={contextLabel}
        tags={contextTags}
        actions={contextActions}
      />
      {filters}
      {resultsBar}
      {feedback}
    </div>
  );
}

export function SecurityFiltersWorkbench({
  title,
  description,
  contextLabel,
  contextTags,
  contextActions,
  searchLabel,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  focusLabel,
  focusValue,
  focusOptions,
  onFocusChange,
  statusLabel,
  statusValue,
  statusOptions,
  onStatusChange,
  roleLabel,
  roleValue,
  roleOptions,
  onRoleChange,
  summaryTags,
  copyLabel,
  onCopy,
  resetLabel,
  onReset,
  feedback,
  className,
}: SecurityFiltersWorkbenchProps) {
  return (
    <SecurityPanelSection title={title} description={description}>
      <SecurityWorkbenchControls
        contextLabel={contextLabel}
        contextTags={contextTags}
        contextActions={contextActions}
        filters={
          <SecurityFiltersWorkbenchFiltersContent
            focusLabel={focusLabel}
            focusOptions={focusOptions}
            focusValue={focusValue}
            onFocusChange={onFocusChange}
            onRoleChange={onRoleChange}
            onSearchChange={onSearchChange}
            onStatusChange={onStatusChange}
            roleLabel={roleLabel}
            roleOptions={roleOptions}
            roleValue={roleValue}
            searchLabel={searchLabel}
            searchPlaceholder={searchPlaceholder}
            searchValue={searchValue}
            statusLabel={statusLabel}
            statusOptions={statusOptions}
            statusValue={statusValue}
          />
        }
        resultsBar={
          <SecurityFiltersWorkbenchResultsBarContent
            copyLabel={copyLabel}
            onCopy={onCopy}
            onReset={onReset}
            resetLabel={resetLabel}
            summaryTags={summaryTags}
          />
        }
        feedback={feedback}
        className={className}
      />
    </SecurityPanelSection>
  );
}
