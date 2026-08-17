'use client';

import { Plus } from 'lucide-react';
import { useLocale } from '@/providers/locale-provider';

interface RolesPageRegistryActionsContentProps {
  beginCreateRole: () => void;
  handleCopyCurrentView: () => void | Promise<void>;
  handleCreateRole: () => void;
}

export function RolesPageRegistryActionsContent({
  beginCreateRole,
  handleCopyCurrentView,
  handleCreateRole,
}: RolesPageRegistryActionsContentProps) {
  const { t } = useLocale();

  return (
    <div className="projectEditorActions">
      <button type="button" className="ghostButton" onClick={handleCopyCurrentView}>
        {t('roles.copyLink')}
      </button>
      <button
        type="button"
        className="secondaryButton"
        onClick={() => {
          handleCreateRole();
          beginCreateRole();
        }}
      >
        <Plus size={14} />
        {t('roles.createAction')}
      </button>
    </div>
  );
}
