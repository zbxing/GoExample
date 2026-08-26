import 'server-only';
import type {
  CreateSystemRoleInput,
  SystemRoleRecord,
  UpdateSystemRoleInput,
} from '@/lib/types/system';
import { createId, nowIso, readJsonFile, writeJsonFile } from '@/lib/server/json-store';

interface RolesFile {
  roles: SystemRoleRecord[];
}

const fileName = 'system-roles.json';

async function loadRoles() {
  const data = await readJsonFile<RolesFile>(fileName, { roles: [] });
  return data.roles;
}

async function saveRoles(roles: SystemRoleRecord[]) {
  await writeJsonFile<RolesFile>(fileName, { roles });
}

export async function listSystemRoles() {
  const roles = await loadRoles();
  return roles.map((role) => ({
    ...role,
    dataScope: role.dataScope ?? 1,
    parentId: role.parentId || '0',
  }));
}

export async function getSystemRolesByIds(roleIds: string[]) {
  const roles = await loadRoles();
  const idSet = new Set(roleIds);
  return roles.filter((role) => idSet.has(role.id));
}

export async function createSystemRole(input: CreateSystemRoleInput) {
  const roles = await loadRoles();
  const id = input.id?.trim() || createId('role');
  if (roles.some((role) => role.id === id)) {
    throw new Error(`Role already exists: ${id}`);
  }

  const role: SystemRoleRecord = {
    id,
    name: input.name.trim(),
    description: input.description?.trim() || '',
    parentId: input.parentId?.trim() || '0',
    defaultRouter: input.defaultRouter?.trim() || '/dashboard',
    dataScope: input.dataScope ?? 1,
    menuIds: input.menuIds ?? [],
    btnAuths: input.btnAuths ?? [],
    locked: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  roles.push(role);
  await saveRoles(roles);
  return role;
}

export async function updateSystemRole(input: UpdateSystemRoleInput) {
  const roles = await loadRoles();
  const index = roles.findIndex((role) => role.id === input.id);
  if (index < 0) {
    throw new Error(`Role not found: ${input.id}`);
  }

  const current = roles[index];
  const next: SystemRoleRecord = {
    ...current,
    name: input.name?.trim() ?? current.name,
    description: input.description?.trim() ?? current.description,
    parentId: input.parentId?.trim() ?? current.parentId,
    defaultRouter: input.defaultRouter?.trim() ?? current.defaultRouter,
    dataScope: input.dataScope ?? current.dataScope ?? 1,
    menuIds: input.menuIds ?? current.menuIds,
    btnAuths: input.btnAuths ?? current.btnAuths,
    updatedAt: nowIso(),
  };
  roles[index] = next;
  await saveRoles(roles);
  return next;
}

export async function deleteSystemRole(roleId: string) {
  const roles = await loadRoles();
  const target = roles.find((role) => role.id === roleId);
  if (!target) {
    throw new Error(`Role not found: ${roleId}`);
  }
  if (target.locked) {
    throw new Error(`Role is locked: ${roleId}`);
  }
  if (roles.some((role) => role.parentId === roleId)) {
    throw new Error(`Role has children: ${roleId}`);
  }
  await saveRoles(roles.filter((role) => role.id !== roleId));
  return { id: roleId };
}

export async function copySystemRole(input: {
  id: string;
  name: string;
  parentId?: string;
  oldAuthorityId: string;
  dataScope?: 1 | 2 | 3 | 4 | 5;
}) {
  const roles = await loadRoles();
  const source = roles.find((role) => role.id === input.oldAuthorityId);
  if (!source) {
    throw new Error(`Role not found: ${input.oldAuthorityId}`);
  }
  if (roles.some((role) => role.id === input.id)) {
    throw new Error(`Role already exists: ${input.id}`);
  }

  const role: SystemRoleRecord = {
    id: input.id.trim(),
    name: input.name.trim(),
    description: source.description,
    parentId: input.parentId?.trim() || source.parentId || '0',
    defaultRouter: source.defaultRouter,
    dataScope: input.dataScope ?? source.dataScope ?? 1,
    menuIds: [...source.menuIds],
    btnAuths: [...source.btnAuths],
    locked: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  roles.push(role);
  await saveRoles(roles);
  return role;
}

export function mergeRoleCapabilities(roles: SystemRoleRecord[]) {
  const menuIds = new Set<string>();
  const btnAuths = new Set<string>();
  let defaultRouter = '/dashboard';

  for (const role of roles) {
    for (const menuId of role.menuIds) {
      menuIds.add(menuId);
    }
    for (const btn of role.btnAuths) {
      btnAuths.add(btn);
    }
    if (role.defaultRouter) {
      defaultRouter = role.defaultRouter;
    }
  }

  return {
    menuIds: [...menuIds],
    btnAuths: [...btnAuths],
    defaultRouter,
  };
}
