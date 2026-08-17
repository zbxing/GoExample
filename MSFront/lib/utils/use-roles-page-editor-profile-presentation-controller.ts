'use client';

import { useMemo } from 'react';
import type { RoleEditorDraft } from '@/lib/utils/use-roles-page-editor-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface RolesEditorFieldBaseModel {
  id: string;
  label: string;
  className?: string;
}

interface RolesEditorInputFieldModel extends RolesEditorFieldBaseModel {
  control: 'input';
  value: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
}

interface RolesEditorTextareaFieldModel extends RolesEditorFieldBaseModel {
  control: 'textarea';
  value: string;
  rows: number;
  disabled?: boolean;
  onChange?: (value: string) => void;
}

export type RolesEditorProfileFieldModel =
  | RolesEditorInputFieldModel
  | RolesEditorTextareaFieldModel;

export interface RolesEditorProfileSectionModel {
  title: string;
  fields: readonly RolesEditorProfileFieldModel[];
}

interface UseRolesPageEditorProfilePresentationControllerOptions {
  canEditRole: boolean;
  draft: RoleEditorDraft | null;
  isCreating: boolean;
  t: TranslationFn;
  updateDraft: (nextPartial: Partial<RoleEditorDraft>) => void;
}

export function useRolesPageEditorProfilePresentationController({
  canEditRole,
  draft,
  isCreating,
  t,
  updateDraft,
}: UseRolesPageEditorProfilePresentationControllerOptions) {
  const profileSection = useMemo<RolesEditorProfileSectionModel>(
    () => ({
      title: t('roles.profileTitle'),
      fields:
        draft
          ? [
              {
                id: 'role-id',
                control: 'input',
                label: t('roles.roleIdLabel'),
                value: draft.id,
                disabled: !isCreating || !canEditRole,
                onChange: (value) => updateDraft({ id: value }),
              },
              {
                id: 'role-name',
                control: 'input',
                label: t('labels.roles'),
                value: draft.name,
                disabled: !canEditRole,
                onChange: (value) => updateDraft({ name: value }),
              },
              {
                id: 'description',
                control: 'textarea',
                label: t('labels.description'),
                value: draft.description,
                rows: 3,
                className: 'fieldWide',
                disabled: !canEditRole,
                onChange: (value) => updateDraft({ description: value }),
              },
            ]
          : [],
    }),
    [canEditRole, draft, isCreating, t, updateDraft],
  );

  return {
    profileSection,
  };
}
