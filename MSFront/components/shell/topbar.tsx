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
import { useTheme } from '@/providers/theme-provider';
import { CommandPalette } from '@/components/shell/command-palette';
import { GvaMorphButton } from '@/components/shell/gva-morph-button';
import {
  GvaSettingDrawer,
  type GvaShellSettings,
} from '@/components/shell/gva-setting-drawer';

interface TopbarProps {
  sidebarId: string;
  isMobileSidebarOpen: boolean;
  onOpenSidebar: () => void;
  shellSettings: GvaShellSettings;
  onShellSettingsChange: (next: GvaShellSettings) => void;
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
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<number | null>(null);
  const crumbs = buildBreadcrumbs(pathname, menus);
  const isDark = theme === 'graphite';

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
    setTheme(isDark ? 'gva' : 'graphite');
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
      <header className="topbar gvaTopbar">
        <div className="gvaTopbarMain">
          <div className="gvaTopbarLeft">
            <button
              type="button"
              className="gvaMobileMenuBtn"
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

            <Link href="/dashboard" className="gvaHeaderBrand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/gva-logo.png" alt="" className="gvaHeaderLogo" />
              <strong>Gin-Vue-Admin</strong>
            </Link>

            <nav className="gvaBreadcrumb" aria-label="面包屑">
              {crumbs.map((crumb, index) => (
                <span key={`${crumb}-${index}`} className="gvaBreadcrumbItem">
                  {index > 0 ? <span className="gvaBreadcrumbSep">/</span> : null}
                  <span className={index === crumbs.length - 1 ? 'gvaBreadcrumbCurrent' : undefined}>
                    {crumb}
                  </span>
                </span>
              ))}
            </nav>
          </div>

          <div className="gvaTopbarActions">
            <div className="gvaHeaderTools">
              <GvaMorphButton
                icon={<Search size={18} />}
                label="搜索"
                onClick={() => setCommandOpenSignal((value) => value + 1)}
              />
              <GvaMorphButton
                icon={<Settings size={18} />}
                label="设置"
                onClick={() => setSettingsOpen(true)}
              />
              <GvaMorphButton
                icon={<RefreshCw size={18} />}
                label="刷新"
                spinning={refreshSpin}
                onClick={handleRefresh}
              />
              <GvaMorphButton
                icon={isDark ? <Sun size={18} /> : <Moon size={18} />}
                label="主题"
                onClick={toggleTheme}
              />
              <div className="gvaToolSlot gvaToolSlotHidden">
                <CommandPalette openSignal={commandOpenSignal} />
              </div>
            </div>

            <div className="gvaHeaderDivider" role="separator" />

            <div
              className="gvaUserMenu"
              ref={menuRef}
              onMouseEnter={openMenu}
              onMouseLeave={scheduleCloseMenu}
            >
              <button
                type="button"
                className="gvaUserTrigger"
                onClick={() => {
                  if (menuPinned) {
                    closeMenu();
                    return;
                  }
                  setMenuPinned(true);
                  setMenuOpen(true);
                }}
              >
                <span className="gvaUserAvatar">
                  <UserRound size={14} />
                </span>
                <span className="gvaUserName">{user?.displayName ?? '用户'}</span>
                <ChevronDown
                  size={16}
                  className="gvaUserCaret"
                  style={{ transform: `rotate(${arrowDeg}deg)` }}
                />
              </button>
              {menuOpen ? (
                <div className="gvaUserDropdown" role="menu">
                  <div className="gvaUserDropdownMeta">
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

      <GvaSettingDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={shellSettings}
        onChange={onShellSettingsChange}
      />
    </>
  );
}

function buildBreadcrumbs(
  pathname: string,
  menus: Array<{ title: string; path: string; children: Array<{ title: string; path: string }> }>,
) {
  const crumbs = ['首页'];
  for (const menu of menus) {
    if (pathname === menu.path || pathname.startsWith(`${menu.path}/`)) {
      crumbs.push(menu.title);
      for (const child of menu.children) {
        if (pathname === child.path || pathname.startsWith(`${child.path}/`)) {
          crumbs.push(child.title);
        }
      }
    }
  }
  if (crumbs.length === 1) {
    crumbs.push(pathname === '/dashboard' ? '仪表盘' : pathname);
  }
  return crumbs;
}
