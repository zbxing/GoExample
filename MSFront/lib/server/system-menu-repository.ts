import 'server-only';
import type {
  CreateSystemMenuInput,
  SystemMenuRecord,
  SystemMenuTreeNode,
  UpdateSystemMenuInput,
} from '@/lib/types/system';
import { createId, nowIso, readJsonFile, writeJsonFile } from '@/lib/server/json-store';

interface MenusFile {
  menus: SystemMenuRecord[];
}

const fileName = 'system-menus.json';

async function loadMenus() {
  const data = await readJsonFile<MenusFile>(fileName, { menus: [] });
  return data.menus;
}

async function saveMenus(menus: SystemMenuRecord[]) {
  await writeJsonFile<MenusFile>(fileName, { menus });
}

export function buildMenuTree(menus: SystemMenuRecord[], parentId = '0'): SystemMenuTreeNode[] {
  return menus
    .filter((menu) => menu.parentId === parentId)
    .sort((left, right) => left.sort - right.sort || left.title.localeCompare(right.title))
    .map((menu) => ({
      ...menu,
      children: buildMenuTree(menus, menu.id),
    }));
}

export function filterMenusByIds(menus: SystemMenuRecord[], menuIds: string[]) {
  const allowed = new Set(menuIds);
  return menus.filter((menu) => allowed.has(menu.id));
}

export async function listSystemMenus() {
  return loadMenus();
}

export async function listSystemMenuTree() {
  return buildMenuTree(await loadMenus());
}

export async function listAsyncMenusForRoles(menuIds: string[]) {
  const allMenus = await loadMenus();
  const allowed = new Set(menuIds);

  for (const menuId of [...allowed]) {
    let current = allMenus.find((menu) => menu.id === menuId);
    while (current && current.parentId !== '0') {
      allowed.add(current.parentId);
      current = allMenus.find((menu) => menu.id === current?.parentId);
    }
  }

  const menus = allMenus.filter((menu) => allowed.has(menu.id) && !menu.hidden);
  return buildMenuTree(menus);
}

export async function createSystemMenu(input: CreateSystemMenuInput) {
  const menus = await loadMenus();
  const menu: SystemMenuRecord = {
    id: createId('menu'),
    parentId: input.parentId?.trim() || '0',
    path: input.path.trim(),
    name: input.name.trim(),
    component: input.component.trim(),
    title: input.title.trim(),
    icon: input.icon?.trim() || 'CircleHelp',
    hidden: Boolean(input.hidden),
    sort: input.sort ?? menus.length + 1,
    keepAlive: Boolean(input.keepAlive),
    menuBtns: input.menuBtns ?? [],
  };
  menus.push(menu);
  await saveMenus(menus);
  return menu;
}

export async function updateSystemMenu(input: UpdateSystemMenuInput) {
  const menus = await loadMenus();
  const index = menus.findIndex((menu) => menu.id === input.id);
  if (index < 0) {
    throw new Error(`Menu not found: ${input.id}`);
  }

  const current = menus[index];
  const next: SystemMenuRecord = {
    ...current,
    parentId: input.parentId?.trim() ?? current.parentId,
    path: input.path?.trim() ?? current.path,
    name: input.name?.trim() ?? current.name,
    component: input.component?.trim() ?? current.component,
    title: input.title?.trim() ?? current.title,
    icon: input.icon?.trim() ?? current.icon,
    hidden: input.hidden ?? current.hidden,
    sort: input.sort ?? current.sort,
    keepAlive: input.keepAlive ?? current.keepAlive,
    menuBtns: input.menuBtns ?? current.menuBtns,
  };
  menus[index] = next;
  await saveMenus(menus);
  return next;
}

export async function deleteSystemMenu(menuId: string) {
  const menus = await loadMenus();
  const remaining = menus.filter((menu) => menu.id !== menuId && menu.parentId !== menuId);
  if (remaining.length === menus.length) {
    throw new Error(`Menu not found: ${menuId}`);
  }
  await saveMenus(remaining);
  return { id: menuId };
}

export function collectAllowedPaths(menus: SystemMenuRecord[]) {
  return new Set(
    menus
      .map((menu) => menu.path)
      .filter((path) => path.startsWith('/') && !path.includes(':') && menuIsLeafPath(path)),
  );
}

function menuIsLeafPath(path: string) {
  return path !== '/system' && path !== '/ops';
}

export function resolveMenuAccess(pathname: string, allowedPaths: Set<string>) {
  if (pathname === '/403' || pathname === '/login') {
    return true;
  }

  if (allowedPaths.has(pathname)) {
    return true;
  }

  for (const allowedPath of allowedPaths) {
    if (pathname.startsWith(`${allowedPath}/`)) {
      return true;
    }
  }

  return false;
}

export { nowIso };
