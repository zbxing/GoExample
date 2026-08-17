'use client';

import { SectionHeader } from '@/components/common/section-header';
import { UsersPageContent } from '@/components/pages/users-page-content';
import { useLocale } from '@/providers/locale-provider';
import type { AccessManagementView } from '@/lib/types/management';
import type { AccessUserStatusFilter } from '@/lib/utils/access-filters';
import { useUsersPageBridgeController } from '@/lib/utils/use-users-page-bridge-controller';

interface UsersPageProps {
  accessManagement: AccessManagementView;
  initialUserId?: string;
  initialRoleId?: string;
  initialStatus?: AccessUserStatusFilter;
  initialSearch?: string;
}

export function UsersPage({
  accessManagement,
  initialUserId = '',
  initialRoleId = '',
  initialStatus = 'all',
  initialSearch = '',
}: UsersPageProps) {
  const { locale, t } = useLocale();
  const { usersPageContentProps } = useUsersPageBridgeController({
    accessManagement,
    locale,
    t,
    initialUserId,
    initialRoleId,
    initialStatus,
    initialSearch,
  });

  return (
    <div className="pageStack">
      <SectionHeader
        eyebrow={t('rbac.eyebrow')}
        title={t('users.title')}
        description={t('users.description')}
      />
      <UsersPageContent {...usersPageContentProps} />
    </div>
  );
}
