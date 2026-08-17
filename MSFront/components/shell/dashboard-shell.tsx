'use client';

import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/shell/sidebar';
import { TagsView } from '@/components/shell/tags-view';
import { Topbar } from '@/components/shell/topbar';
import { BottomInfo } from '@/components/shell/bottom-info';
import {
  getGvaShellSettingsServerSnapshot,
  readGvaShellSettings,
  subscribeGvaShellSettings,
  writeGvaShellSettings,
  type GvaShellSettings,
} from '@/components/shell/gva-setting-drawer';
import { useAuth } from '@/providers/auth-provider';
import { collectLeafPaths } from '@/lib/utils/menu-access';

const mobileShellMediaQuery = '(max-width: 920px)';

export function DashboardShell({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const router = useRouter();
  const sidebarId = useId();
  const { menus, isLoading, user } = useAuth();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const shellSettings = useSyncExternalStore(
    subscribeGvaShellSettings,
    readGvaShellSettings,
    getGvaShellSettingsServerSnapshot,
  );
  const previousPathnameRef = useRef(pathname);

  function closeMobileSidebar() {
    setIsMobileSidebarOpen(false);
  }

  function openMobileSidebar() {
    if (typeof window !== 'undefined' && !window.matchMedia(mobileShellMediaQuery).matches) {
      return;
    }
    setIsMobileSidebarOpen(true);
  }

  function toggleSidebarCollapse() {
    setIsSidebarCollapsed((currentValue) => !currentValue);
  }

  function handleShellSettingsChange(next: GvaShellSettings) {
    writeGvaShellSettings(next);
  }

  const handleEscapeKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      closeMobileSidebar();
    }
  });

  useEffect(() => {
    if (!isMobileSidebarOpen) {
      return;
    }

    const mediaQueryList = window.matchMedia(mobileShellMediaQuery);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleViewportChange = (event: MediaQueryListEvent) => {
      if (!event.matches) {
        closeMobileSidebar();
      }
    };

    window.addEventListener('keydown', handleEscapeKey);
    mediaQueryList.addEventListener('change', handleViewportChange);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleEscapeKey);
      mediaQueryList.removeEventListener('change', handleViewportChange);
    };
  }, [isMobileSidebarOpen]);

  useEffect(() => {
    if (previousPathnameRef.current !== pathname && isMobileSidebarOpen) {
      setIsMobileSidebarOpen(false);
    }
    previousPathnameRef.current = pathname;
  }, [isMobileSidebarOpen, pathname]);

  useEffect(() => {
    if (isLoading || !user || pathname === '/403') {
      return;
    }

    const allowed = collectLeafPaths(menus);
    const alwaysAllowed = new Set(['/dashboard', '/403', '/settings']);
    if (alwaysAllowed.has(pathname)) {
      return;
    }

    const ok =
      allowed.has(pathname) ||
      [...allowed].some((path) => pathname.startsWith(`${path}/`)) ||
      user.roleIds.includes('888');

    if (!ok && menus.length > 0) {
      router.replace('/403');
    }
  }, [isLoading, menus, pathname, router, user]);

  return (
    <div
      className="appShell gvaAppShell"
      data-sidebar-collapsed={isSidebarCollapsed ? 'true' : 'false'}
      data-sidebar-open={isMobileSidebarOpen ? 'true' : 'false'}
      data-dark-sider={shellSettings.darkSider ? 'true' : 'false'}
    >
      <Topbar
        sidebarId={sidebarId}
        isMobileSidebarOpen={isMobileSidebarOpen}
        onOpenSidebar={openMobileSidebar}
        shellSettings={shellSettings}
        onShellSettingsChange={handleShellSettingsChange}
      />
      <div className="gvaBody">
        <Sidebar
          sidebarId={sidebarId}
          isCollapsed={isSidebarCollapsed}
          isMobileOpen={isMobileSidebarOpen}
          darkSider={shellSettings.darkSider}
          onClose={closeMobileSidebar}
          onToggleCollapse={toggleSidebarCollapse}
        />
        <div className="gvaMainColumn">
          <TagsView
            tabMode={shellSettings.tabMode}
            showTabIcon={shellSettings.showTabIcon}
          />
          {isMobileSidebarOpen ? (
            <div className="sidebarBackdrop" role="presentation" onClick={closeMobileSidebar} />
          ) : null}
          <div className="appContent gvaAppContent">
            <main className="pageContent gvaPageContent">
              {isLoading ? <div className="adminLoading">加载中…</div> : children}
            </main>
            <BottomInfo className="gvaLayoutFooter" />
          </div>
        </div>
      </div>
    </div>
  );
}
