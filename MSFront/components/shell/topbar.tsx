'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  ChevronDown,
  Moon,
  RefreshCw,
  Search,
  Settings,
  Sun,
  UserRound,
} from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { applyTheme, useTheme } from '@/providers/theme-provider';
import { CommandPalette } from '@/components/shell/command-palette';
import { FnaMorphButton } from '@/components/shell/fna-morph-button';
import {
  FnaSettingDrawer,
  type FnaShellSettings,
} from '@/components/shell/fna-setting-drawer';
import type { SystemMenuTreeNode } from '@/lib/types/system';

interface TopbarProps {
  sidebarId: string;
  isMobileSidebarOpen: boolean;
  onOpenSidebar: () => void;
  shellSettings: FnaShellSettings;
  onShellSettingsChange: (next: FnaShellSettings) => void;
}

export function Topbar({
  sidebarId,
  isMobileSidebarOpen,
  onOpenSidebar,
  shellSettings,
  onShellSettingsChange,
}: TopbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, menus } = useAuth();
  const { theme, setTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPinned, setMenuPinned] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [commandOpenSignal, setCommandOpenSignal] = useState(0);
  const [arrowDeg, setArrowDeg] = useState(0);
  /** 仅客户端挂载后切换日月图标，避免 SSR/水合 HTML 不一致 */
  const [themeIconReady, setThemeIconReady] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<number | null>(null);
  const crumbs = buildBreadcrumbs(pathname, menus);
  const isDark = themeIconReady && theme === 'graphite';

  useEffect(() => {
    setThemeIconReady(true);
  }, []);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
        setMenuPinned(false);
      }
    }
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, []);

  function clearCloseTimer() {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function openMenu() {
    clearCloseTimer();
    setMenuOpen((current) => {
      if (!current) {
        queueMicrotask(() => setArrowDeg((value) => value + 180));
      }
      return true;
    });
  }

  function scheduleCloseMenu() {
    if (menuPinned) {
      return;
    }
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => {
      setMenuOpen((current) => {
        if (current) {
          queueMicrotask(() => setArrowDeg((value) => value + 180));
        }
        return false;
      });
    }, 120);
  }

  function toggleTheme() {
    const nextDark = !isDark;
    const nextTheme = nextDark ? 'graphite' : 'fna';
    // 先同步 html class，再写 shell 设置，避免 applyFnaShellCss 读到旧的 dark 状态
    applyTheme(nextTheme);
    setTheme(nextTheme);
    onShellSettingsChange({
      ...shellSettings,
      themeScheme: nextDark ? 'dark' : 'light',
    });
  }

  function handleRefresh() {
    setRefreshSpin(true);
    router.refresh();
    window.setTimeout(() => setRefreshSpin(false), 1000);
  }

  function closeMenu() {
    setMenuOpen((current) => {
      if (current) {
        queueMicrotask(() => setArrowDeg((value) => value + 180));
      }
      return false;
    });
    setMenuPinned(false);
  }

  return (
    <>
      <header className="topbar fnaTopbar">
        <div className="fnaTopbarMain">
          <div className="fnaTopbarLeft">
            <button
              type="button"
              className="fnaMobileMenuBtn"
              aria-controls={sidebarId}
              aria-expanded={isMobileSidebarOpen}
              onClick={onOpenSidebar}
            >
              <span className="srOnly">打开菜单</span>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M4 6h16M4 12h16M4 18h16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>

            <Link href="/dashboard" className="fnaHeaderBrand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/fna-logo.png" alt="" className="fnaHeaderLogo" />
              <strong>FNA</strong>
            </Link>

            <nav className="fnaBreadcrumb" aria-label="面包屑" hidden={!shellSettings.header.breadcrumb.visible}>
              {crumbs.map((crumb, index) => (
                <span key={`${crumb}-${index}`} className="fnaBreadcrumbItem">
                  {index > 0 ? <span className="fnaBreadcrumbSep">/</span> : null}
                  <span className={index === crumbs.length - 1 ? 'fnaBreadcrumbCurrent' : undefined}>
                    {crumb}
                  </span>
                </span>
              ))}
            </nav>
          </div>

          <div className="fnaTopbarActions">
            <div className="fnaHeaderTools">
              {shellSettings.header.search.visible ? (
                <FnaMorphButton
                  icon={<Search size={18} />}
                  label="搜索"
                  onClick={() => setCommandOpenSignal((value) => value + 1)}
                />
              ) : null}
              <FnaMorphButton
                icon={<Settings size={18} />}
                label="设置"
                onClick={() => setSettingsOpen(true)}
              />
              {shellSettings.header.refresh.visible ? (
                <FnaMorphButton
                  icon={<RefreshCw size={18} />}
                  label="刷新"
                  spinning={refreshSpin}
                  onClick={handleRefresh}
                />
              ) : null}
              <FnaMorphButton
                icon={isDark ? <Sun size={18} /> : <Moon size={18} />}
                label="主题"
                onClick={toggleTheme}
              />
              <div className="fnaToolSlot fnaToolSlotHidden">
                <CommandPalette openSignal={commandOpenSignal} />
              </div>
            </div>

            <div className="fnaHeaderDivider" role="separator" />

            <div
              className="fnaUserMenu"
              ref={menuRef}
              onMouseEnter={openMenu}
              onMouseLeave={scheduleCloseMenu}
            >
              <button
                type="button"
                className="fnaUserTrigger"
                onClick={() => {
                  if (menuPinned) {
                    closeMenu();
                    return;
                  }
                  setMenuPinned(true);
                  setMenuOpen(true);
                }}
              >
                <span className="fnaUserAvatar">
                  <UserRound size={14} />
                </span>
                <span className="fnaUserName">{user?.displayName ?? '用户'}</span>
                <ChevronDown
                  size={16}
                  className="fnaUserCaret"
                  style={{ transform: `rotate(${arrowDeg}deg)` }}
                />
              </button>
              {menuOpen ? (
                <div className="fnaUserDropdown" role="menu">
                  <div className="fnaUserDropdownMeta">
                    <strong>{user?.displayName ?? '用户'}</strong>
                    <p>当前角色：{user?.roleNames?.[0] ?? '未分配'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      closeMenu();
                      router.push('/settings' as Route);
                    }}
                  >
                    个人信息
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      closeMenu();
                      setSettingsOpen(true);
                    }}
                  >
                    系统配置
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      closeMenu();
                      void logout();
                    }}
                  >
                    登 出
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <FnaSettingDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={shellSettings}
        onChange={onShellSettingsChange}
      />
    </>
  );
}

const BREADCRUMB_FALLBACKS: Record<string, string> = {
  '/dashboard': '仪表盘',
  '/settings': '配置文件',
  '/about': '关于我们',
  '/403': '无权限',
};

/** 在菜单树中按 path 精确匹配，返回从根到该节点的标题链（子 path 可不带父前缀） */
function findMenuTitleChain(
  menus: SystemMenuTreeNode[],
  pathname: string,
  ancestors: string[] = [],
): string[] | null {
  for (const menu of menus) {
    const titles = menu.title ? [...ancestors, menu.title] : ancestors;
    if (menu.path === pathname) {
      return titles;
    }
    if (menu.children.length > 0) {
      const found = findMenuTitleChain(menu.children, pathname, titles);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function buildBreadcrumbs(pathname: string, menus: SystemMenuTreeNode[]) {
  const crumbs = ['首页'];
  const chain = findMenuTitleChain(menus, pathname);
  if (chain && chain.length > 0) {
    crumbs.push(...chain);
    return crumbs;
  }
  crumbs.push(BREADCRUMB_FALLBACKS[pathname] ?? pathname);
  return crumbs;
}
