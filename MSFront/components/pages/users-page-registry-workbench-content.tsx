'use client';

import type { Route } from 'next';
import { RegistryWorkbenchControls } from '@/components/common/registry-workbench-controls';
import {
  UsersPageRegistryWorkbenchBulkActionsContent,
} from '@/components/pages/users-page-registry-workbench-bulk-actions-content';
import {
  UsersPageRegistryWorkbenchContextActionsContent,
} from '@/components/pages/users-page-registry-workbench-context-actions-content';
import {
  UsersPageRegistryWorkbenchFiltersContent,
} from '@/components/pages/users-page-registry-workbench-filters-content';
import {
  UsersPageRegistryWorkbenchSelectionSummaryContent,
} from '@/components/pages/users-page-registry-workbench-selection-summary-content';
import { useLocale } from '@/providers/locale-provider';
import type { AccessManagedUserEntry } from '@/lib/types/management';
import type { AccessUserStatusFilter } from '@/lib/utils/access-filters';

export interface BulkSummaryModel {
  selectVisibleLabel: string;
  selectedCountLabel: string;
}

interface UsersRegistryWorkbenchContentProps {
  bulkRoleId: string;
  bulkSummary: BulkSummaryModel;
  bulkUpdateRole: (mode: 'assign' | 'remove') => void;
  bulkUpdateStatus: (status: 'active' | 'disabled') => void;
  canBulkAssignRole: boolean;
  canBulkDisable: boolean;
  canBulkEnable: boolean;
  canBulkRemoveRole: boolean;
  filteredUsers: readonly AccessManagedUserEntry[];
  handleBulkRoleChange: (value: string) => void;
  handleCopyCurrentView: () => void | Promise<void>;
  handleRoleFilterChange: (value: string) => void;
  handleSearchChange: (value: string) => void;
  handleStatusFilterChange: (value: AccessUserStatusFilter) => void;
  isPending: boolean;
  roleFilter: string;
  roleOptions: readonly string[];
  search: string;
  selectedCount: number;
  statusFilter: AccessUserStatusFilter;
  toggleVisibleSelection: (users: readonly AccessManagedUserEntry[]) => void;
  usersContextRolesHref: Route;
  usersContextSecurityHref: Route;
  usersContextTags: readonly string[];
}

export function UsersRegistryWorkbenchContent({
  bulkRoleId,
  bulkSummary,
  bulkUpdateRole,
  bulkUpdateStatus,
  canBulkAssignRole,
  canBulkDisable,
  canBulkEnable,
  canBulkRemoveRole,
  filteredUsers,
  handleBulkRoleChange,
  handleCopyCurrentView,
  handleRoleFilterChange,
  handleSearchChange,
  handleStatusFilterChange,
  isPending,
  roleFilter,
  roleOptions,
  search,
  selectedCount,
  statusFilter,
  toggleVisibleSelection,
  usersContextRolesHref,
  usersContextSecurityHref,
  usersContextTags,
}: UsersRegistryWorkbenchContentProps) {
  const { t } = useLocale();

  return (
    <RegistryWorkbenchControls
      contextLabel={`${t('nav.security')} / ${t('labels.users')}`}
      contextTags={usersContextTags}
      contextActions={
        <UsersPageRegistryWorkbenchContextActionsContent
          usersContextRolesHref={usersContextRolesHref}
          usersContextSecurityHref={usersContextSecurityHref}
        />
      }
      filters={
        <UsersPageRegistryWorkbenchFiltersContent
          handleRoleFilterChange={handleRoleFilterChange}
          handleSearchChange={handleSearchChange}
          handleStatusFilterChange={handleStatusFilterChange}
          roleFilter={roleFilter}
          roleOptions={roleOptions}
          search={search}
          statusFilter={statusFilter}
        />
      }
      footer={
        <>
          <UsersPageRegistryWorkbenchSelectionSummaryContent
            bulkSummary={bulkSummary}
            filteredUsers={filteredUsers}
            toggleVisibleSelection={toggleVisibleSelection}
          />
          <UsersPageRegistryWorkbenchBulkActionsContent
            bulkRoleId={bulkRoleId}
            bulkUpdateRole={bulkUpdateRole}
            bulkUpdateStatus={bulkUpdateStatus}
            canBulkAssignRole={canBulkAssignRole}
            canBulkDisable={canBulkDisable}
            canBulkEnable={canBulkEnable}
            canBulkRemoveRole={canBulkRemoveRole}
            handleBulkRoleChange={handleBulkRoleChange}
            handleCopyCurrentView={handleCopyCurrentView}
            isPending={isPending}
            roleOptions={roleOptions}
            selectedCount={selectedCount}
          />
        </>
      }
    />
  );
}
