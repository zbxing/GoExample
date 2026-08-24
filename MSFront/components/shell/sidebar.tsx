'use client';

import Link from 'next/link';
import { createElement, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ChevronDown, ChevronsLeft, ChevronsRight, X } from 'lucide-react';
import type { Route } from 'next';
import { resolveMenuIcon } from '@/lib/utils/menu-icons';
import { useAuth } from '@/providers/auth-provider';
import type { GvaMenuCollapseMode, GvaMenuTheme } from '@/lib/utils/gva-shell-settings';
import type { SystemMenuTreeNode } from '@/lib/types/system';

interface SidebarProps {
  sidebarId: string;
  isCollapsed: boolean;
  isMobileOpen: boolean;
  darkSider: boolean;
  menuTheme: GvaMenuTheme;
  collapseMode: GvaMenuCollapseMode;
  showCollapseButton: boolean;
  onClose: () => void;
  onToggleCollapse: () => void;
}

function menuIndent(depth: number) {
  return `${12 + depth * 12}px`;
}

function isPathActive(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

function hasActiveDescendant(menu: SystemMenuTreeNode, pathname: string): boolean {
  if (isPathActive(pathname, menu.path) && menu.children.length === 0) {
    return true;
  }
  return menu.children.some((child) => hasActiveDescendant(child, pathname));
}

/** 从根到目标节点的祖先路径（含自身） */
function findMenuPathById(menus: SystemMenuTreeNode[], targetId: string): string[] {
  const path: string[] = [];
  const dfs = (item: SystemMenuTreeNode): boolean => {
    path.push(item.id);
    if (item.id === targetId) {
      return true;
    }
    for (const child of item.children) {
      if (dfs(child)) {
        return true;
      }
    }
    path.pop();
    return false;
  };
  for (const menu of menus) {
    if (dfs(menu)) {
      return [...path];
    }
  }
  return [];
}

function collectSubtreeIds(node: SystemMenuTreeNode): string[] {
  const keys = [node.id];
  for (const child of node.children) {
    keys.push(...collectSubtreeIds(child));
  }
  return keys;
}

function collectAllBranchIds(menus: SystemMenuTreeNode[]): string[] {
  const keys: string[] = [];
  const walk = (items: SystemMenuTreeNode[]) => {
    for (const item of items) {
      if (item.children.length > 0) {
        keys.push(item.id);
        walk(item.children);
      }
    }
  };
  walk(menus);
  return keys;
}

/** 当前激活叶子路径上的祖先分支（不含叶子） */
function collectActiveAncestorIds(menus: SystemMenuTreeNode[], pathname: string): string[] {
  const find = (items: SystemMenuTreeNode[], ancestors: string[]): string[] | null => {
    for (const item of items) {
      if (item.children.length === 0) {
        if (isPathActive(pathname, item.path)) {
          return ancestors;
        }
        continue;
      }
      const found = find(item.children, [...ancestors, item.id]);
      if (found) {
        return found;
      }
    }
    return null;
  };
  return find(menus, []) ?? [];
}

function resolveOpenIds(
  menus: SystemMenuTreeNode[],
  pathname: string,
  mode: GvaMenuCollapseMode,
): Set<string> {
  if (mode === 'all') {
    return new Set(collectAllBranchIds(menus));
  }
  return new Set(collectActiveAncestorIds(menus, pathname));
}

/** 自定义模式：手动展开优先；当前路由祖先在未手动收起时临时展开 */
function resolveCustomExpanded(
  menus: SystemMenuTreeNode[],
  pathname: string,
  manualOpenIds: Set<string>,
  manualClosedIds: Set<string>,
): Set<string> {
  const next = new Set(manualOpenIds);
  for (const id of collectActiveAncestorIds(menus, pathname)) {
    if (!manualClosedIds.has(id)) {
      next.add(id);
    }
  }
  for (const id of manualClosedIds) {
    next.delete(id);
  }
  return next;
}

export function Sidebar({
  sidebarId,
  isCollapsed,
  isMobileOpen,
  darkSider,
  menuTheme,
  collapseMode,
  showCollapseButton,
  onClose,
  onToggleCollapse,
}: SidebarProps) {
  const { menus } = useAuth();
  const menuKey = menus.map((menu) => menu.id).join('|');

  return (
    <aside
      id={sidebarId}
      className="sidebar gvaSidebar"
      data-collapsed={isCollapsed ? 'true' : 'false'}
      data-mobile-open={isMobileOpen ? 'true' : 'false'}
      data-dark={darkSider ? 'true' : 'false'}
      data-menu-theme={menuTheme}
      aria-label="侧边导航"
    >
      <div className="sidebarMobileHeader">
        <span className="serviceCategory">Go Admin</span>
        <button type="button" className="sidebarCloseButton" onClick={onClose} aria-label="关闭">
          <X size={16} />
          <span>关闭</span>
        </button>
      </div>

      <SidebarNav
        key={`${menuKey || 'empty'}:${collapseMode}`}
        menus={menus}
        isCollapsed={isCollapsed}
        collapseMode={collapseMode}
        onNavigate={onClose}
      />

      {showCollapseButton ? (
        <button
          type="button"
          className="gvaCollapseBar"
          aria-label={isCollapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-expanded={!isCollapsed}
          onClick={onToggleCollapse}
        >
          {isCollapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      ) : null}
    </aside>
  );
}

function SidebarNav({
  menus,
  isCollapsed,
  collapseMode,
  onNavigate,
}: {
  menus: SystemMenuTreeNode[];
  isCollapsed: boolean;
  collapseMode: GvaMenuCollapseMode;
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const menuStructureKey = menus.map((menu) => menu.id).join('|');
  /** 用户手动展开的分支 */
  const manualOpenRef = useRef(new Set<string>());
  /** 用户手动收起的分支（优先于路由临时展开） */
  const manualClosedRef = useRef(new Set<string>());
  const [expandedIds, setExpandedIds] = useState(() => resolveOpenIds(menus, pathname, collapseMode));

  useEffect(() => {
    if (collapseMode !== 'custom') {
      setExpandedIds(resolveOpenIds(menus, pathname, collapseMode));
      return;
    }

    setExpandedIds(
      resolveCustomExpanded(menus, pathname, manualOpenRef.current, manualClosedRef.current),
    );
    // menus 由外层 key=menuStructureKey 保证结构变化时整树重挂
  }, [collapseMode, menuStructureKey, pathname]);

  function toggleExpand(menu: SystemMenuTreeNode) {
    const opened = expandedIds.has(menu.id);

    if (collapseMode === 'current') {
      if (opened) {
        const next = new Set(expandedIds);
        for (const id of collectSubtreeIds(menu)) {
          next.delete(id);
        }
        setExpandedIds(next);
        return;
      }
      setExpandedIds(new Set(findMenuPathById(menus, menu.id)));
      return;
    }

    if (collapseMode === 'all') {
      const next = new Set(expandedIds);
      if (opened) {
        next.delete(menu.id);
      } else {
        next.add(menu.id);
      }
      setExpandedIds(next);
      return;
    }

    // custom：只更新手动态，展示态由 resolveCustomExpanded 统一计算
    if (opened) {
      for (const id of collectSubtreeIds(menu)) {
        manualOpenRef.current.delete(id);
      }
      manualClosedRef.current.add(menu.id);
    } else {
      manualClosedRef.current.delete(menu.id);
      manualOpenRef.current.add(menu.id);
    }
    setExpandedIds(
      resolveCustomExpanded(menus, pathname, manualOpenRef.current, manualClosedRef.current),
    );
  }

  return (
    <nav className="sidebarNav gvaNav">
      {menus.length === 0 ? (
        <div className="gvaMenuEmpty" role="status">
          暂无菜单
        </div>
      ) : null}
      {menus.map((menu) => (
        <MenuNode
          key={menu.id}
          menu={menu}
          pathname={pathname}
          isCollapsed={isCollapsed}
          expandedIds={expandedIds}
          onToggleExpand={toggleExpand}
          onNavigate={onNavigate}
          level={0}
        />
      ))}
    </nav>
  );
}

function MenuNode({
  menu,
  pathname,
  isCollapsed,
  expandedIds,
  onToggleExpand,
  onNavigate,
  level,
}: {
  menu: SystemMenuTreeNode;
  pathname: string;
  isCollapsed: boolean;
  expandedIds: Set<string>;
  onToggleExpand: (menu: SystemMenuTreeNode) => void;
  onNavigate: () => void;
  level: number;
}) {
  const hasChildren = menu.children.length > 0;
  const expanded = expandedIds.has(menu.id);
  const Icon = resolveMenuIcon(menu.icon);
  const leafActive = !hasChildren && isPathActive(pathname, menu.path);
  const branchActive = hasChildren && hasActiveDescendant(menu, pathname);
  const iconOnly = isCollapsed && level === 0;

  if (hasChildren) {
    if (iconOnly) {
      return (
        <button
          type="button"
          className={branchActive ? 'gvaMenuItem is-branch-active' : 'gvaMenuItem'}
          style={{ height: 48 }}
          title={menu.title}
          onClick={() => onToggleExpand(menu)}
        >
          {createElement(Icon, { size: 18, className: 'gvaMenuIcon' })}
        </button>
      );
    }

    return (
      <div className="gvaMenuBranch" data-open={expanded ? 'true' : 'false'}>
        <button
          type="button"
          className={branchActive ? 'gvaMenuItem is-branch-active' : 'gvaMenuItem'}
          style={{ height: 48, paddingLeft: menuIndent(level) }}
          onClick={() => onToggleExpand(menu)}
        >
          {createElement(Icon, { size: 18, className: 'gvaMenuIcon' })}
          <span className="gvaMenuTitle">{menu.title}</span>
          <ChevronDown
            size={16}
            className={expanded ? 'gvaMenuChevron is-open' : 'gvaMenuChevron'}
          />
        </button>
        <div className={expanded ? 'gvaMenuChildren is-open' : 'gvaMenuChildren'}>
          <div className="gvaMenuChildrenInner">
            {menu.children.map((child) => (
              <MenuNode
                key={child.id}
                menu={child}
                pathname={pathname}
                isCollapsed={isCollapsed}
                expandedIds={expandedIds}
                onToggleExpand={onToggleExpand}
                onNavigate={onNavigate}
                level={level + 1}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (iconOnly) {
    return (
      <Link
        href={menu.path as Route}
        className={leafActive ? 'gvaMenuItem is-active' : 'gvaMenuItem'}
        style={{ height: 48 }}
        title={menu.title}
        onClick={onNavigate}
      >
        {createElement(Icon, { size: 18, className: 'gvaMenuIcon' })}
      </Link>
    );
  }

  return (
    <Link
      href={menu.path as Route}
      className={leafActive ? 'gvaMenuItem is-active' : 'gvaMenuItem'}
      style={{ height: 48, paddingLeft: menuIndent(level) }}
      onClick={onNavigate}
    >
      {createElement(Icon, { size: 18, className: 'gvaMenuIcon' })}
      <span className="gvaMenuTitle">{menu.title}</span>
    </Link>
  );
}
