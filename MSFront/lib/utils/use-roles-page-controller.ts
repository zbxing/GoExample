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
  buildContextualSecurityHref,
  buildContextualUsersHref,
  type AccessNavigationContext,
} from '@/lib/utils/access-navigation';
import {
  buildRolesHref,
  normalizeAccessSearch,
  resolveAccessRoleId,
  resolveAccessUserId,
  resolveRolesFilterState,
  type RolesFilterState,
} from '@/lib/utils/access-filters';
import { copyTextToClipboard } from '@/lib/utils/clipboard';
import { useUrlFilterHistory } from '@/lib/utils/use-url-filter-history';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface UseRolesPageControllerOptions {
  pathname: string;
  roles: readonly AccessManagedRoleEntry[];
  users: readonly AccessManagedUserEntry[];
  initialRoleId?: string;
  initialMemberId?: string;
  initialSearch?: string;
  clearFeedback: () => void;
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
  t: TranslationFn;
}

export function useRolesPageController({
  pathname,
  roles,
  users,
  initialRoleId = '',
  initialMemberId = '',
  initialSearch = '',
  clearFeedback,
  showError,
  showSuccess,
  t,
}: UseRolesPageControllerOptions) {
  const initialSelectedRole = selectManagedRole(roles, initialRoleId);
  const normalizedInitialRoleId = resolveAccessRoleId(
    roles.map((role) => role.id),
    initialRoleId,
  );
  const normalizedInitialMemberId = resolveAccessUserId(
    users.map((user) => user.id),
    initialMemberId,
  );
  const normalizedInitialSearch = normalizeAccessSearch(initialSearch);
  const [linkedRoleId, setLinkedRoleId] = useState<string>(normalizedInitialRoleId);
  const [selectedRoleId, setSelectedRoleId] = useState<string>(initialSelectedRole?.id ?? '');
  const [focusedMemberId, setFocusedMemberId] = useState<string>(normalizedInitialMemberId);
  const [search, setSearch] = useState(normalizedInitialSearch);
  const [isCreating, setIsCreating] = useState(false);
  const currentFilterState = useMemo<RolesFilterState>(
    () => ({
      roleId: isCreating ? '' : linkedRoleId,
      userId: focusedMemberId,
      search,
    }),
    [focusedMemberId, isCreating, linkedRoleId, search],
  );
  const currentFilterHref = useMemo(
    () => buildRolesHref(currentFilterState),
    [currentFilterState],
  );
  const accessNavigationContext = useMemo<AccessNavigationContext>(
    () => ({
      roles: currentFilterState,
    }),
    [currentFilterState],
  );
  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? null;
  const focusedMember = users.find((user) => user.id === focusedMemberId) ?? null;
  const currentRoleId = !isCreating ? selectedRole?.id || linkedRoleId : '';
  const roleMembers = useMemo(
    () =>
      currentRoleId
        ? users.filter((user) => user.roles.includes(currentRoleId))
        : [],
    [currentRoleId, users],
  );
  const rolesContextTags = [
    isCreating
      ? `${t('labels.roles')}: ${t('roles.createAction')}`
      : selectedRole?.name
        ? `${t('labels.roles')}: ${selectedRole.name}`
        : null,
    focusedMember ? `${t('labels.users')}: ${focusedMember.displayName}` : null,
    search ? `${t('roles.searchLabel')}: ${search}` : null,
  ].filter((value): value is string => Boolean(value));
  const rolesContextUsersHref = buildContextualUsersHref(accessNavigationContext, {
    roleId: currentRoleId || undefined,
    userId: focusedMember?.id || roleMembers[0]?.id,
  });
  const rolesContextSecurityHref = buildContextualSecurityHref(accessNavigationContext, {
    focus: 'users',
    role: currentRoleId || undefined,
    search:
      focusedMember?.username || focusedMember?.displayName || focusedMember?.id || undefined,
  });

  function syncFiltersFromUrl(nextSearchParams: URLSearchParams) {
    const nextFilters = resolveRolesFilterState(
      {
        roleId: nextSearchParams.get('roleId'),
        userId: nextSearchParams.get('userId'),
        search: nextSearchParams.get('search'),
      },
      roles.map((role) => role.id),
      users.map((user) => user.id),
    );
    const nextSelectedRole = selectManagedRole(roles, nextFilters.roleId);

    setSearch(nextFilters.search);
    setLinkedRoleId(nextFilters.roleId);
    setSelectedRoleId(nextSelectedRole?.id ?? '');
    setFocusedMemberId(nextFilters.userId);
    setIsCreating(false);
    clearFeedback();
  }

  useUrlFilterHistory({
    pathname,
    currentState: currentFilterState,
    getCurrentHref: () => currentFilterHref,
    syncFromUrl: syncFiltersFromUrl,
    shouldPushHistory: shouldPushRolesHistory,
  });

  function handleSearchChange(value: string) {
    clearFeedback();
    setSearch(value);
  }

  function handleCreateRole() {
    clearFeedback();
    setIsCreating(true);
    setLinkedRoleId('');
    setSelectedRoleId('');
    setFocusedMemberId('');
  }

  function handleSelectRole(role: AccessManagedRoleEntry) {
    clearFeedback();
    setLinkedRoleId(role.id);
    setSelectedRoleId(role.id);
    setFocusedMemberId('');
    setIsCreating(false);
  }

  function applyAccessManagementSnapshot(
    nextAccessManagement: AccessManagementView,
    preferredRoleId?: string,
  ) {
    const nextSelectedRole = selectManagedRole(
      nextAccessManagement.roles,
      preferredRoleId ?? selectedRoleId,
    );
    const nextLinkedRoleId =
      linkedRoleId && nextAccessManagement.roles.some((role) => role.id === linkedRoleId)
        ? linkedRoleId
        : '';

    setLinkedRoleId(nextLinkedRoleId);
    setSelectedRoleId(nextSelectedRole?.id ?? '');
    setFocusedMemberId((currentUserId) =>
      currentUserId && nextAccessManagement.users.some((user) => user.id === currentUserId)
        ? currentUserId
        : '',
    );
    setIsCreating(false);
  }

  async function handleCopyCurrentView() {
    clearFeedback();

    try {
      await copyTextToClipboard(window.location.href);
      showSuccess(t('roles.copyFiltersSuccess'));
    } catch {
      showError(t('roles.copyFiltersError'));
    }
  }

  return {
    accessNavigationContext,
    applyAccessManagementSnapshot,
    currentRoleId,
    focusedMemberId,
    handleCopyCurrentView,
    handleCreateRole,
    handleSearchChange,
    handleSelectRole,
    isCreating,
    rolesContextSecurityHref,
    rolesContextTags,
    rolesContextUsersHref,
    search,
    selectedRoleId,
  };
}

function selectManagedRole(
  roles: readonly AccessManagedRoleEntry[],
  preferredRoleId?: string,
) {
  return (
    roles.find((role) => role.id === preferredRoleId) ??
    roles[0] ??
    null
  );
}

function shouldPushRolesHistory(
  previousFilters: RolesFilterState | null,
  nextFilters: RolesFilterState,
) {
  if (!previousFilters) {
    return false;
  }

  return (
    previousFilters.roleId !== nextFilters.roleId ||
    previousFilters.userId !== nextFilters.userId
  );
}
