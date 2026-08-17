'use client';

import { SectionHeader } from '@/components/common/section-header';
import { RolesPageContent } from '@/components/pages/roles-page-content';
import { useLocale } from '@/providers/locale-provider';
import type { AccessManagementView } from '@/lib/types/management';
import { useRolesPageBridgeController } from '@/lib/utils/use-roles-page-bridge-controller';

interface RolesPageProps {
  accessManagement: AccessManagementView;
  initialRoleId?: string;
  initialMemberId?: string;
  initialSearch?: string;
}

export function RolesPage({
  accessManagement,
  initialRoleId = '',
  initialMemberId = '',
  initialSearch = '',
}: RolesPageProps) {
  const { locale, t } = useLocale();
  const { rolesPageContentProps } = useRolesPageBridgeController({
    accessManagement,
    locale,
    t,
    initialRoleId,
    initialMemberId,
    initialSearch,
  });

  return (
    <div className="pageStack">
      <SectionHeader
        eyebrow={t('rbac.eyebrow')}
        title={t('roles.title')}
        description={t('roles.description')}
      />
      <RolesPageContent {...rolesPageContentProps} />
    </div>
  );
}
