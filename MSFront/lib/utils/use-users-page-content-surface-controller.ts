'use client';

import {
  type UseUsersPageLowerContentSurfaceControllerOptions,
  useUsersPageLowerContentSurfaceController,
} from '@/lib/utils/use-users-page-lower-content-surface-controller';
import {
  type UseUsersPageOverviewContentSurfaceControllerOptions,
  useUsersPageOverviewContentSurfaceController,
} from '@/lib/utils/use-users-page-overview-content-surface-controller';

type UseUsersPageContentSurfaceControllerOptions =
  UseUsersPageOverviewContentSurfaceControllerOptions &
  UseUsersPageLowerContentSurfaceControllerOptions;

export function useUsersPageContentSurfaceController(
  options: UseUsersPageContentSurfaceControllerOptions,
) {
  const { usersPageOverviewContentProps } = useUsersPageOverviewContentSurfaceController(options);
  const { usersPageLowerContentProps } = useUsersPageLowerContentSurfaceController(options);

  return {
    usersPageContentProps: {
      ...usersPageOverviewContentProps,
      ...usersPageLowerContentProps,
    },
    usersPageLowerContentProps,
    usersPageOverviewContentProps,
  };
}
