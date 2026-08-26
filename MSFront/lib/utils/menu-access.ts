import type { SystemMenuRecord, SystemMenuTreeNode } from '@/lib/types/system';

export function sortMenuSiblings<T extends Pick<SystemMenuRecord, 'sort' | 'title'>>(nodes: T[]): T[] {
  return [...nodes].sort(
    (left, right) =>
      left.sort - right.sort || left.title.localeCompare(right.title, 'zh-CN'),
  );
}

/** Rebuild tree from flat records (parentId only; ignore nested children). */
export function buildMenuTreeFromFlat(items: SystemMenuRecord[]): SystemMenuTreeNode[] {
  const records = items.map((item) => ({
    id: item.id,
    parentId: item.parentId || '0',
    path: item.path,
    name: item.name,
    component: item.component,
    title: item.title,
    icon: item.icon,
    hidden: item.hidden,
    sort: item.sort,
    keepAlive: item.keepAlive,
    menuBtns: item.menuBtns ?? [],
  }));

  function walk(parentId: string): SystemMenuTreeNode[] {
    return sortMenuSiblings(records.filter((item) => item.parentId === parentId)).map((item) => ({
      ...item,
      children: walk(item.id),
    }));
  }
  return walk('0');
}

/**
 * Layer sequence (BFS by depth):
 * - Level 1 (roots): 1, 2, 3…
 * - Level 2: continues from next number (e.g. 4…)
 * - Deeper levels likewise
 */
export function assignMenuLayerSequenceNos(roots: SystemMenuTreeNode[]): Map<string, number> {
  const nos = new Map<string, number>();
  let next = 1;
  let layer = sortMenuSiblings(roots);
  while (layer.length > 0) {
    const nextLayer: SystemMenuTreeNode[] = [];
    for (const node of layer) {
      nos.set(String(node.id), next);
      next += 1;
      if (node.children.length > 0) {
        nextLayer.push(...sortMenuSiblings(node.children));
      }
    }
    layer = nextLayer;
  }
  return nos;
}

export type MenuVisibleRow = SystemMenuTreeNode & {
  depth: number;
  hasChildren: boolean;
  seqNo: number;
};

export function flattenVisibleMenuTree(
  nodes: SystemMenuTreeNode[],
  expanded: Set<string>,
  sequenceNos: Map<string, number>,
  depth = 0,
): MenuVisibleRow[] {
  const rows: MenuVisibleRow[] = [];
  for (const node of sortMenuSiblings(nodes)) {
    const hasChildren = node.children.length > 0;
    const id = String(node.id);
    rows.push({
      ...node,
      depth,
      hasChildren,
      seqNo: sequenceNos.get(id) ?? 0,
    });
    if (hasChildren && expanded.has(id)) {
      rows.push(...flattenVisibleMenuTree(node.children, expanded, sequenceNos, depth + 1));
    }
  }
  return rows;
}

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

/** GVA menu.vue min-width shares (sum 1540) → percent of table */
export const GVA_MENU_COL_WIDTH = {
  id: '6.5%',
  title: '7.8%',
  icon: '9.1%',
  name: '10.4%',
  path: '10.4%',
  hidden: '6.5%',
  parentId: '5.8%',
  sort: '4.5%',
  component: '23.4%',
  actions: '15.6%',
} as const;
