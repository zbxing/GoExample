'use client';

import Link from 'next/link';
import { createElement, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ChevronDown, ChevronsLeft, ChevronsRight, X } from 'lucide-react';
import type { Route } from 'next';
import { resolveMenuIcon } from '@/lib/utils/menu-icons';
import { useAuth } from '@/providers/auth-provider';
import type { SystemMenuTreeNode } from '@/lib/types/system';

interface SidebarProps {
  sidebarId: string;
  isCollapsed: boolean;
  isMobileOpen: boolean;
  darkSider: boolean;
  menuTheme: 'design' | 'light' | 'group';
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

export function Sidebar({
  sidebarId,
  isCollapsed,
  isMobileOpen,
  darkSider,
  menuTheme,
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
        <span className="serviceCategory">Gin-Vue-Admin</span>
        <button type="button" className="sidebarCloseButton" onClick={onClose} aria-label="关闭">
          <X size={16} />
          <span>关闭</span>
        </button>
      </div>

      <SidebarNav
        key={menuKey || 'empty'}
        menus={menus}
        isCollapsed={isCollapsed}
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
  onNavigate,
}: {
  menus: SystemMenuTreeNode[];
  isCollapsed: boolean;
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const [expandedIds, setExpandedIds] = useState(() => {
    const initial = new Set<string>();
    for (const menu of menus) {
      if (hasActiveDescendant(menu, pathname) || menu.children.length > 0) {
        initial.add(menu.id);
      }
    }
    return initial;
  });

  function toggleExpand(menu: SystemMenuTreeNode) {
    setExpandedIds((current) => {
      const opened = current.has(menu.id);
      if (opened) {
        const next = new Set(current);
        next.delete(menu.id);
        return next;
      }
      // unique-opened：同级只保留当前展开路径
      return new Set([menu.id]);
    });
  }

  return (
    <nav className="sidebarNav gvaNav">
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
