'use client';

import {
  Save,
  Trash2,
} from 'lucide-react';
import type {
  ManagedProject,
  ManagedProjectDraft,
} from '@/lib/types/management';
import { useLocale } from '@/providers/locale-provider';

interface ProjectManagementConsoleEditorActionsContentProps {
  activeProject: ManagedProject | null;
  draft: ManagedProjectDraft | null;
  isCreating: boolean;
  isPending: boolean;
  removeProject: () => void;
  saveProject: () => void;
}

export function ProjectManagementConsoleEditorActionsContent({
  activeProject,
  draft,
  isCreating,
  isPending,
  removeProject,
  saveProject,
}: ProjectManagementConsoleEditorActionsContentProps) {
  const { t } = useLocale();

  return (
    <div className="projectEditorActions">
      {activeProject && !isCreating ? (
        <button type="button" className="dangerButton" onClick={removeProject} disabled={isPending}>
          <Trash2 size={14} />
          {t('actions.deleteProject')}
        </button>
      ) : null}
      <button
        type="button"
        className="primaryButton"
        onClick={saveProject}
        disabled={!draft || isPending}
      >
        <Save size={14} />
        {t('actions.saveProject')}
      </button>
    </div>
  );
}
