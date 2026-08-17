import 'server-only';
import type {
  CreateSystemUserInput,
  SystemUserPublic,
  SystemUserRecord,
  UpdateSystemUserInput,
} from '@/lib/types/system';
import { hashPassword, needsPasswordRehash, verifyPassword } from '@/lib/server/password';
import { createId, nowIso, readJsonFile, writeJsonFile } from '@/lib/server/json-store';
import {
  getSystemRolesByIds,
  listSystemRoles,
  mergeRoleCapabilities,
} from '@/lib/server/system-role-repository';

interface UsersFile {
  users: SystemUserRecord[];
}

const fileName = 'system-users.json';

async function loadUsers() {
  const data = await readJsonFile<UsersFile>(fileName, { users: [] });
  return data.users;
}

async function saveUsers(users: SystemUserRecord[]) {
  await writeJsonFile<UsersFile>(fileName, { users });
}

function toPublicUser(user: SystemUserRecord, roleNames: string[]): SystemUserPublic {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    phone: user.phone,
    status: user.status,
    roleIds: user.roleIds,
    roleNames,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function resolveRoleNames(roleIds: string[]) {
  const roles = await getSystemRolesByIds(roleIds);
  return roles.map((role) => role.name);
}

export async function listSystemUsers(search = '') {
  const users = await loadUsers();
  const roles = await listSystemRoles();
  const roleNameMap = new Map(roles.map((role) => [role.id, role.name]));
  const keyword = search.trim().toLowerCase();

  return users
    .filter((user) => {
      if (!keyword) {
        return true;
      }
      return (
        user.username.toLowerCase().includes(keyword) ||
        user.displayName.toLowerCase().includes(keyword) ||
        user.email.toLowerCase().includes(keyword)
      );
    })
    .map((user) =>
      toPublicUser(
        user,
        user.roleIds.map((roleId) => roleNameMap.get(roleId) || roleId),
      ),
    );
}

export async function getSystemUserById(userId: string) {
  const users = await loadUsers();
  return users.find((user) => user.id === userId) ?? null;
}

export async function getSystemUserByUsername(username: string) {
  const users = await loadUsers();
  return users.find((user) => user.username === username) ?? null;
}

export async function authenticateSystemUser(username: string, password: string) {
  const users = await loadUsers();
  const index = users.findIndex((user) => user.username === username.trim());
  const user = index >= 0 ? users[index] : null;
  if (!user || user.status !== 'active') {
    return null;
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    return null;
  }

  if (needsPasswordRehash(user.passwordHash)) {
    const upgradedUser = {
      ...user,
      passwordHash: await hashPassword(password),
      updatedAt: nowIso(),
    };
    users[index] = upgradedUser;
    await saveUsers(users);
    return upgradedUser;
  }

  return user;
}

export async function buildAuthSessionUser(user: SystemUserRecord) {
  const roles = await getSystemRolesByIds(user.roleIds);
  const capabilities = mergeRoleCapabilities(roles);

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    phone: user.phone,
    status: user.status,
    roleIds: user.roleIds,
    roleNames: roles.map((role) => role.name),
    btnAuths: capabilities.btnAuths,
    menuIds: capabilities.menuIds,
    defaultRouter: capabilities.defaultRouter,
  };
}

export async function createSystemUser(input: CreateSystemUserInput) {
  const users = await loadUsers();
  if (users.some((user) => user.username === input.username.trim())) {
    throw new Error(`Username already exists: ${input.username}`);
  }

  const user: SystemUserRecord = {
    id: createId('u'),
    username: input.username.trim(),
    passwordHash: await hashPassword(input.password),
    displayName: input.displayName.trim() || input.username.trim(),
    email: input.email?.trim() || '',
    phone: input.phone?.trim() || '',
    status: input.status ?? 'active',
    roleIds: input.roleIds,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  users.push(user);
  await saveUsers(users);
  return toPublicUser(user, await resolveRoleNames(user.roleIds));
}

export async function updateSystemUser(input: UpdateSystemUserInput) {
  const users = await loadUsers();
  const index = users.findIndex((user) => user.id === input.id);
  if (index < 0) {
    throw new Error(`User not found: ${input.id}`);
  }

  const current = users[index];
  const passwordHash = input.password
    ? await hashPassword(input.password)
    : current.passwordHash;
  const next: SystemUserRecord = {
    ...current,
    displayName: input.displayName?.trim() ?? current.displayName,
    email: input.email?.trim() ?? current.email,
    phone: input.phone?.trim() ?? current.phone,
    status: input.status ?? current.status,
    roleIds: input.roleIds ?? current.roleIds,
    passwordHash,
    updatedAt: nowIso(),
  };
  users[index] = next;
  await saveUsers(users);
  return toPublicUser(next, await resolveRoleNames(next.roleIds));
}

export async function deleteSystemUser(userId: string) {
  const users = await loadUsers();
  const target = users.find((user) => user.id === userId);
  if (!target) {
    throw new Error(`User not found: ${userId}`);
  }
  if (target.username === 'admin') {
    throw new Error('Cannot delete the seeded admin user');
  }
  await saveUsers(users.filter((user) => user.id !== userId));
  return { id: userId };
}
