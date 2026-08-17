'use client';

import {
  useMemo,
  useState,
} from 'react';
import type {
  AccessManagedRoleEntry,
  AccessManagedUserEntry,
  AccessManagementView,
} from '@/lib/types/management';
import {
  buildContextualRolesHref,
  buildContextualSecurityHref,
  type AccessNavigationContext,
} from '@/lib/utils/access-navigation';
import {
  buildUsersHref,
  resolveUsersFilterState,
  type AccessUserStatusFilter,
  type UsersFilterState,
} from '@/lib/utils/access-filters';
import { copyTextToClipboard } from '@/lib/utils/clipboard';
import { humanizeIdentifier } from '@/lib/utils/format';
import { useUrlFilterHistory } from '@/lib/utils/use-url-filter-history';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseUsersPageControllerOptions {
  pathname: string;
  users: readonly AccessManagedUserEntry[];
  roles: readonly AccessManagedRoleEntry[];
  initialUserId?: string;
  initialRoleId?: string;
  initialStatus?: AccessUserStatusFilter;
  initialSearch?: string;
  clearFeedback: () => void;
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
  t: TranslationFn;
}

export function useUsersPageController({
  pathname,
  users,
  roles,
  initialUserId = '',
  initialRoleId = '',
  initialStatus = 'all',
  initialSearch = '',
  clearFeedback,
  showError,
  showSuccess,
  t,
}: UseUsersPageControllerOptions) {
  const initialFilters = resolveUsersFilterState(
    {
      userId: initialUserId,
      roleId: initialRoleId,
      status: initialStatus,
      search: initialSearch,
    },
    users.map((user) => user.id),
    roles.map((role) => role.id),
  );
  const initialSelectedUser = selectManagedUser(users, initialFilters.userId);
  const [linkedUserId, setLinkedUserId] = useState<string>(initialFilters.userId);
  const [selectedUserId, setSelectedUserId] = useState<string>(initialSelectedUser?.id ?? '');
  const [search, setSearch] = useState(initialFilters.search);
  const [statusFilter, setStatusFilter] = useState<AccessUserStatusFilter>(initialFilters.status);
  const [roleFilter, setRoleFilter] = useState<string>(initialFilters.roleId);
  const currentFilterState = useMemo<UsersFilterState>(
    () => ({
      userId: linkedUserId,
      roleId: roleFilter,
      status: statusFilter,
      search,
    }),
    [linkedUserId, roleFilter, search, statusFilter],
  );
  const currentFilterHref = useMemo(
    () => buildUsersHref(currentFilterState),
    [currentFilterState],
  );
  const accessNavigationContext = useMemo<AccessNavigationContext>(
    () => ({
      users: currentFilterState,
    }),
    [currentFilterState],
  );
  const selectedUser = users.find((user) => user.id === selectedUserId) ?? null;
  const currentUserRoleId = roleFilter !== 'all' ? roleFilter : (selectedUser?.roles[0] ?? '');
  const usersContextTags = [
    selectedUser ? `${t('labels.users')}: ${selectedUser.displayName}` : null,
    `${t('labels.roles')}: ${
      roleFilter === 'all' ? t('users.allRoles') : humanizeIdentifier(roleFilter)
    }`,
    `${t('labels.status')}: ${
      statusFilter === 'all' ? t('users.allStatuses') : t(`security.status.${statusFilter}`)
    }`,
    search ? `${t('users.searchLabel')}: ${search}` : null,
  ].filter((value): value is string => Boolean(value));
  const usersContextRolesHref = useMemo(
    () =>
      buildContextualRolesHref(accessNavigationContext, {
        roleId: currentUserRoleId || undefined,
        userId: selectedUser?.id,
      }),
    [accessNavigationContext, currentUserRoleId, selectedUser?.id],
  );
  const usersContextSecurityHref = useMemo(
    () =>
      buildContextualSecurityHref(accessNavigationContext, {
        focus: 'users',
        role: currentUserRoleId || undefined,
        search: search || userSearchToken(selectedUser),
      }),
    [accessNavigationContext, currentUserRoleId, search, selectedUser],
  );

  function syncFiltersFromUrl(nextSearchParams: URLSearchParams) {
    const nextFilters = resolveUsersFilterState(
      {
        userId: nextSearchParams.get('userId'),
        roleId: nextSearchParams.get('roleId'),
        status: nextSearchParams.get('status'),
        search: nextSearchParams.get('search'),
      },
      users.map((user) => user.id),
      roles.map((role) => role.id),
    );
    const nextSelectedUser = selectManagedUser(users, nextFilters.userId);

    setSearch(nextFilters.search);
    setStatusFilter(nextFilters.status);
    setRoleFilter(nextFilters.roleId);
    setLinkedUserId(nextFilters.userId);
    setSelectedUserId(nextSelectedUser?.id ?? '');
    clearFeedback();
  }

  useUrlFilterHistory({
    pathname,
    currentState: currentFilterState,
    getCurrentHref: () => currentFilterHref,
    syncFromUrl: syncFiltersFromUrl,
    shouldPushHistory: shouldPushUsersHistory,
  });

  function handleSearchChange(value: string) {
    clearFeedback();
    setSearch(value);
  }

  function handleStatusFilterChange(value: AccessUserStatusFilter) {
    clearFeedback();
    setStatusFilter(value);
  }

  function handleRoleFilterChange(value: string) {
    clearFeedback();
    setRoleFilter(value);
  }

  function focusUser(user: AccessManagedUserEntry) {
    setLinkedUserId(user.id);
    setSelectedUserId(user.id);
    clearFeedback();
  }

  function applyAccessManagementSnapshot(
    nextAccessManagement: AccessManagementView,
    preferredUserId?: string,
  ) {
    const nextSelectedUser = selectManagedUser(
      nextAccessManagement.users,
      preferredUserId ?? selectedUserId,
    );
    const nextLinkedUserId =
      linkedUserId && nextAccessManagement.users.some((user) => user.id === linkedUserId)
        ? linkedUserId
        : '';

    setLinkedUserId(nextLinkedUserId);
    setSelectedUserId(nextSelectedUser?.id ?? '');
    setRoleFilter((currentRoleId) =>
      currentRoleId === 'all' || nextAccessManagement.roles.some((role) => role.id === currentRoleId)
        ? currentRoleId
        : 'all',
    );
  }

  async function handleCopyCurrentView() {
    clearFeedback();

    try {
      await copyTextToClipboard(window.location.href);
      showSuccess(t('users.copyFiltersSuccess'));
    } catch {
      showError(t('users.copyFiltersError'));
    }
  }

  return {
    accessNavigationContext,
    applyAccessManagementSnapshot,
    focusUser,
    handleCopyCurrentView,
    handleRoleFilterChange,
    handleSearchChange,
    handleStatusFilterChange,
    roleFilter,
    search,
    selectedUserId,
    statusFilter,
    usersContextRolesHref,
    usersContextSecurityHref,
    usersContextTags,
  };
}

function selectManagedUser(
  users: readonly AccessManagedUserEntry[],
  preferredUserId?: string,
) {
  return (
    users.find((user) => user.id === preferredUserId) ??
    users[0] ??
    null
  );
}

function userSearchToken(user: AccessManagedUserEntry | null) {
  if (!user) {
    return '';
  }

  return user.username || user.displayName || user.id;
}

function shouldPushUsersHistory(
  previousFilters: UsersFilterState | null,
  nextFilters: UsersFilterState,
) {
  if (!previousFilters) {
    return false;
  }

  return (
    previousFilters.userId !== nextFilters.userId ||
    previousFilters.roleId !== nextFilters.roleId ||
    previousFilters.status !== nextFilters.status
  );
}
