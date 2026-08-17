'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useLocale } from '@/providers/locale-provider';

interface RolesPageRegistryWorkbenchContextActionsContentProps {
  rolesContextSecurityHref: Route;
  rolesContextUsersHref: Route;
}

export function RolesPageRegistryWorkbenchContextActionsContent({
  rolesContextSecurityHref,
  rolesContextUsersHref,
}: RolesPageRegistryWorkbenchContextActionsContentProps) {
  const { t } = useLocale();

  return (
    <>
      <Link href={rolesContextUsersHref} className="secondaryButton">
        {t('roles.posture.actions.openUsers')}
        <ArrowRight size={14} />
      </Link>
      <Link href={rolesContextSecurityHref} className="secondaryButton">
        {t('roles.posture.actions.openSecurity')}
        <ArrowRight size={14} />
      </Link>
    </>
  );
}
