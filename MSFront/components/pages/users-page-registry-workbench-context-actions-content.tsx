'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useLocale } from '@/providers/locale-provider';

interface UsersPageRegistryWorkbenchContextActionsContentProps {
  usersContextRolesHref: Route;
  usersContextSecurityHref: Route;
}

export function UsersPageRegistryWorkbenchContextActionsContent({
  usersContextRolesHref,
  usersContextSecurityHref,
}: UsersPageRegistryWorkbenchContextActionsContentProps) {
  const { t } = useLocale();

  return (
    <>
      <Link href={usersContextRolesHref} className="secondaryButton">
        {t('users.posture.actions.openRoles')}
        <ArrowRight size={14} />
      </Link>
      <Link href={usersContextSecurityHref} className="secondaryButton">
        {t('users.posture.actions.openSecurity')}
        <ArrowRight size={14} />
      </Link>
    </>
  );
}
