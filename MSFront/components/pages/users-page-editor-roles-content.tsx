'use client';

import type { Route } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  Shield,
} from 'lucide-react';
import { EditorSection } from '@/components/common/editor-section';
import {
  AccessSelectionGrid,
  AccessSelectionOptionCard,
} from '@/components/common/access-selection-surface';
import { useLocale } from '@/providers/locale-provider';

interface RoleSectionOptionModel {
  id: string;
  checked: boolean;
  title: string;
  description: string;
  inputAriaLabel: string;
  roleDetailsHref: Route;
  securityContextHref: Route;
}

export interface RoleSectionModel {
  title: string;
  actionLabel: string;
  actionHref: Route;
  options: readonly RoleSectionOptionModel[];
}

interface UsersEditorRolesContentProps {
  rolesSection: RoleSectionModel;
  toggleRole: (roleId: string) => void;
}

export function UsersEditorRolesContent({
  rolesSection,
  toggleRole,
}: UsersEditorRolesContentProps) {
  const { t } = useLocale();

  return (
    <EditorSection
      icon={<Shield size={16} />}
      title={rolesSection.title}
      actions={
        <Link href={rolesSection.actionHref} className="secondaryButton">
          {rolesSection.actionLabel}
          <ArrowRight size={14} />
        </Link>
      }
    >
      <AccessSelectionGrid>
        {rolesSection.options.map((role) => (
          <AccessSelectionOptionCard
            key={role.id}
            checked={role.checked}
            onChange={() => toggleRole(role.id)}
            inputAriaLabel={role.inputAriaLabel}
            content={
              <>
                <strong>{role.title}</strong>
                <span>{role.description}</span>
              </>
            }
            actions={
              <>
                <Link href={role.roleDetailsHref} className="securityInlineLink">
                  {t('users.actions.openRoleDetails')}
                </Link>
                <Link href={role.securityContextHref} className="securityInlineLink">
                  {t('users.actions.openSecurityContext')}
                </Link>
              </>
            }
          />
        ))}
      </AccessSelectionGrid>
    </EditorSection>
  );
}
