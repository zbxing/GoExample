'use client';

import {
  Save,
  Trash2,
} from 'lucide-react';
import { useLocale } from '@/providers/locale-provider';

interface RolesEditorActionsContentProps {
  canEditRole: boolean;
  draft: {
    locked: boolean;
  } | null;
  isCreating: boolean;
  isPending: boolean;
  removeRole: () => void;
  saveRole: () => void;
}

export function RolesEditorActionsContent({
  canEditRole,
  draft,
  isCreating,
  isPending,
  removeRole,
  saveRole,
}: RolesEditorActionsContentProps) {
  const { t } = useLocale();

  return (
    <div className="projectEditorActions">
      {!isCreating && draft && !draft.locked ? (
        <button type="button" className="dangerButton" onClick={removeRole} disabled={isPending}>
          <Trash2 size={14} />
          {t('roles.deleteAction')}
        </button>
      ) : null}
      <button
        type="button"
        className="primaryButton"
        onClick={saveRole}
        disabled={!draft || isPending || !canEditRole}
      >
        <Save size={14} />
        {t('roles.saveAction')}
      </button>
    </div>
  );
}
