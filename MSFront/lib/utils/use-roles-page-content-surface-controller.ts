'use client';

import {
  type UseRolesPageLowerContentSurfaceControllerOptions,
  useRolesPageLowerContentSurfaceController,
} from '@/lib/utils/use-roles-page-lower-content-surface-controller';
import {
  type UseRolesPageOverviewContentSurfaceControllerOptions,
  useRolesPageOverviewContentSurfaceController,
} from '@/lib/utils/use-roles-page-overview-content-surface-controller';

type UseRolesPageContentSurfaceControllerOptions =
  UseRolesPageOverviewContentSurfaceControllerOptions &
  UseRolesPageLowerContentSurfaceControllerOptions;

export function useRolesPageContentSurfaceController(
  options: UseRolesPageContentSurfaceControllerOptions,
) {
  const { rolesPageOverviewContentProps } = useRolesPageOverviewContentSurfaceController(options);
  const { rolesPageLowerContentProps } = useRolesPageLowerContentSurfaceController(options);

  return {
    rolesPageContentProps: {
      ...rolesPageOverviewContentProps,
      ...rolesPageLowerContentProps,
    },
    rolesPageLowerContentProps,
    rolesPageOverviewContentProps,
  };
}
