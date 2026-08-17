'use client';

import { Plus } from 'lucide-react';
import { useLocale } from '@/providers/locale-provider';

interface ProjectManagementConsoleRegistryActionsContentProps {
  allowCreate: boolean;
  createProject: () => void;
}

export function ProjectManagementConsoleRegistryActionsContent({
  allowCreate,
  createProject,
}: ProjectManagementConsoleRegistryActionsContentProps) {
  const { t } = useLocale();

  if (!allowCreate) {
    return null;
  }

  return (
    <button type="button" className="secondaryButton" onClick={createProject}>
      <Plus size={14} />
      {t('actions.createProject')}
    </button>
  );
}
