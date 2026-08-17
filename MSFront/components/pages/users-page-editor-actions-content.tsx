'use client';

import { Save } from 'lucide-react';
import { useLocale } from '@/providers/locale-provider';
import type { AccessManagedUserEntry } from '@/lib/types/management';

interface UsersEditorActionsContentProps {
  draft: object | null;
  isPending: boolean;
  saveUser: () => void;
  selectedUser: AccessManagedUserEntry | null;
}

export function UsersEditorActionsContent({
  draft,
  isPending,
  saveUser,
  selectedUser,
}: UsersEditorActionsContentProps) {
  const { t } = useLocale();

  return (
    <button
      type="button"
      className="primaryButton"
      onClick={saveUser}
      disabled={!draft || !selectedUser || isPending}
    >
      <Save size={14} />
      {t('users.saveAction')}
    </button>
  );
}
