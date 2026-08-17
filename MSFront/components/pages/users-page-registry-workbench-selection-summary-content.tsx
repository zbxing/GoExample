'use client';

import { CheckCheck } from 'lucide-react';
import type { AccessManagedUserEntry } from '@/lib/types/management';
import type { BulkSummaryModel } from '@/components/pages/users-page-registry-workbench-content';

interface UsersPageRegistryWorkbenchSelectionSummaryContentProps {
  bulkSummary: BulkSummaryModel;
  filteredUsers: readonly AccessManagedUserEntry[];
  toggleVisibleSelection: (users: readonly AccessManagedUserEntry[]) => void;
}

export function UsersPageRegistryWorkbenchSelectionSummaryContent({
  bulkSummary,
  filteredUsers,
  toggleVisibleSelection,
}: UsersPageRegistryWorkbenchSelectionSummaryContentProps) {
  return (
    <div className="tagList">
      <button
        type="button"
        className="ghostButton"
        onClick={() => toggleVisibleSelection(filteredUsers)}
      >
        <CheckCheck size={14} />
        {bulkSummary.selectVisibleLabel}
      </button>
      <span className="securityTag">{bulkSummary.selectedCountLabel}</span>
    </div>
  );
}
