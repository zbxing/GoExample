import type { SystemMenuTreeNode } from '@/lib/types/system';

export function collectLeafPaths(menus: SystemMenuTreeNode[], bucket = new Set<string>()) {
  for (const menu of menus) {
    if (menu.children.length > 0) {
      collectLeafPaths(menu.children, bucket);
    } else if (menu.path.startsWith('/')) {
      bucket.add(menu.path);
    }
  }
  return bucket;
}

export function flattenMenuTree(menus: SystemMenuTreeNode[]): SystemMenuTreeNode[] {
  const result: SystemMenuTreeNode[] = [];
  for (const menu of menus) {
    result.push(menu);
    if (menu.children.length > 0) {
      result.push(...flattenMenuTree(menu.children));
    }
  }
  return result;
}
