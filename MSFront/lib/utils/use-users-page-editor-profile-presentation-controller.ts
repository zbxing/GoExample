'use client';

import { useMemo } from 'react';
import type {
  AccessManagedUserEntry,
  FrameworkUserStatus,
} from '@/lib/types/management';
import type { UserEditorDraft } from '@/lib/utils/use-users-page-editor-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

export interface UsersProfileSummaryField {
  id: string;
  label: string;
  value: string;
  detail: string;
}

interface UsersStatusOption {
  value: FrameworkUserStatus;
  label: string;
}

interface UsersEditorFieldBaseModel {
  id: string;
  label: string;
  className?: string;
}

interface UsersEditorInputFieldModel extends UsersEditorFieldBaseModel {
  control: 'input';
  value: string;
  disabled?: boolean;
  readOnly?: boolean;
  onChange?: (value: string) => void;
}

interface UsersEditorSelectFieldModel extends UsersEditorFieldBaseModel {
  control: 'select';
  value: string;
  onChange: (value: string) => void;
  options: readonly UsersStatusOption[];
}

interface UsersEditorSummaryFieldModel extends UsersEditorFieldBaseModel {
  control: 'summary';
  value: string;
  detail: string;
}

export type UsersEditorProfileFieldModel =
  | UsersEditorInputFieldModel
  | UsersEditorSelectFieldModel
  | UsersEditorSummaryFieldModel;

export interface UsersEditorProfileSectionModel {
  title: string;
  fields: readonly UsersEditorProfileFieldModel[];
}

interface UseUsersPageEditorProfilePresentationControllerOptions {
  draft: UserEditorDraft | null;
  profileSummaryFields: readonly UsersProfileSummaryField[];
  selectedUser: AccessManagedUserEntry | null;
  t: TranslationFn;
  updateDraft: (nextPartial: Partial<UserEditorDraft>) => void;
}

export function useUsersPageEditorProfilePresentationController({
  draft,
  profileSummaryFields,
  selectedUser,
  t,
  updateDraft,
}: UseUsersPageEditorProfilePresentationControllerOptions) {
  const statusOptions = useMemo<UsersStatusOption[]>(
    () => [
      {
        value: 'active',
        label: t('security.status.active'),
      },
      {
        value: 'disabled',
        label: t('security.status.disabled'),
      },
    ],
    [t],
  );
  const profileSection = useMemo<UsersEditorProfileSectionModel>(
    () => ({
      title: t('users.profileTitle'),
      fields:
        draft && selectedUser
          ? [
              {
                id: 'username',
                control: 'input',
                label: t('labels.users'),
                value: selectedUser.username,
                disabled: true,
                readOnly: true,
              },
              {
                id: 'display-name',
                control: 'input',
                label: t('users.displayNameLabel'),
                value: draft.displayName,
                onChange: (value) => updateDraft({ displayName: value }),
              },
              {
                id: 'status',
                control: 'select',
                label: t('labels.status'),
                value: draft.status,
                onChange: (value) => updateDraft({ status: value as FrameworkUserStatus }),
                options: statusOptions,
              },
              ...profileSummaryFields.map((field) => ({
                id: field.id,
                control: 'summary' as const,
                label: field.label,
                value: field.value,
                detail: field.detail,
              })),
            ]
          : [],
    }),
    [draft, profileSummaryFields, selectedUser, statusOptions, t, updateDraft],
  );

  return {
    profileSection,
  };
}
