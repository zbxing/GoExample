'use client';

import {
  Shield,
  UserPlus,
  UserX,
} from 'lucide-react';
import { useLocale } from '@/providers/locale-provider';
import { humanizeIdentifier } from '@/lib/utils/format';

interface UsersPageRegistryWorkbenchBulkActionsContentProps {
  bulkRoleId: string;
  bulkUpdateRole: (mode: 'assign' | 'remove') => void;
  bulkUpdateStatus: (status: 'active' | 'disabled') => void;
  canBulkAssignRole: boolean;
  canBulkDisable: boolean;
  canBulkEnable: boolean;
  canBulkRemoveRole: boolean;
  handleBulkRoleChange: (value: string) => void;
  handleCopyCurrentView: () => void | Promise<void>;
  isPending: boolean;
  roleOptions: readonly string[];
  selectedCount: number;
}

export function UsersPageRegistryWorkbenchBulkActionsContent({
  bulkRoleId,
  bulkUpdateRole,
  bulkUpdateStatus,
  canBulkAssignRole,
  canBulkDisable,
  canBulkEnable,
  canBulkRemoveRole,
  handleBulkRoleChange,
  handleCopyCurrentView,
  isPending,
  roleOptions,
  selectedCount,
}: UsersPageRegistryWorkbenchBulkActionsContentProps) {
  const { t } = useLocale();

  return (
    <div className="projectEditorActions">
      <button type="button" className="ghostButton" onClick={handleCopyCurrentView}>
        {t('users.copyLink')}
      </button>
      <label className="filterField usersBulkRoleField">
        <span>{t('users.bulk.roleLabel')}</span>
        <select
          value={bulkRoleId}
          onChange={(event) => handleBulkRoleChange(event.target.value)}
          disabled={roleOptions.length === 0}
        >
          {roleOptions.length === 0 ? (
            <option value="">{t('users.bulk.noRoles')}</option>
          ) : null}
          {roleOptions.map((roleId) => (
            <option key={roleId} value={roleId}>
              {humanizeIdentifier(roleId)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="secondaryButton"
        onClick={() => bulkUpdateRole('assign')}
        disabled={selectedCount === 0 || !canBulkAssignRole || isPending}
      >
        <UserPlus size={14} />
        {t('users.bulk.assignRoleAction')}
      </button>
      <button
        type="button"
        className="ghostButton"
        onClick={() => bulkUpdateRole('remove')}
        disabled={selectedCount === 0 || !canBulkRemoveRole || isPending}
      >
        <Shield size={14} />
        {t('users.bulk.removeRoleAction')}
      </button>
      <button
        type="button"
        className="secondaryButton"
        onClick={() => bulkUpdateStatus('active')}
        disabled={selectedCount === 0 || !canBulkEnable || isPending}
      >
        {t('users.bulk.enableAction')}
      </button>
      <button
        type="button"
        className="dangerButton"
        onClick={() => bulkUpdateStatus('disabled')}
        disabled={selectedCount === 0 || !canBulkDisable || isPending}
      >
        <UserX size={14} />
        {t('users.bulk.disableAction')}
      </button>
    </div>
  );
}
