'use client';

import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  Suspense,
  type PropsWithChildren,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/shell/sidebar';
import { TagsView } from '@/components/shell/tags-view';
import { Topbar } from '@/components/shell/topbar';
import { BottomInfo } from '@/components/shell/bottom-info';
import { GvaPageTransition } from '@/components/shell/gva-page-transition';
import { GvaRouteLoadingEffects } from '@/components/shell/gva-page-loading';
import { resetGvaPageLeave } from '@/lib/utils/gva-page-leave';
import {
  applyGvaShellCss,
  getGvaShellSettingsServerSnapshot,
  readGvaShellSettings,
  subscribeGvaShellSettings,
  writeGvaShellSettings,
  type GvaShellSettings,
} from '@/lib/utils/gva-shell-settings';
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

  useEffect(() => {
    applyGvaShellCss(shellSettings);
  }, [shellSettings]);

  // 「顶部导航」布局会隐藏侧栏；若本地误存成 head，自动恢复经典布局以露出侧栏
  useEffect(() => {
    if (shellSettings.layout.mode !== 'head') {
      return;
    }
    writeGvaShellSettings({
      ...shellSettings,
      layout: { ...shellSettings.layout, mode: 'normal' },
    });
  }, [shellSettings]);

  // 仅在壳层挂载/卸载时清理残留离场层；不要在 pathname 变化时清，否则会掐断离场动画
  useEffect(() => {
    resetGvaPageLeave();
    return () => resetGvaPageLeave();
  }, []);

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
      data-dark-sider={shellSettings.menu.darkSider ? 'true' : 'false'}
      data-menu-theme={shellSettings.menu.theme}
      data-layout={shellSettings.layout.mode}
      data-card-mode={shellSettings.card.mode}
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
          darkSider={shellSettings.menu.darkSider}
          menuTheme={shellSettings.menu.theme}
          showCollapseButton={shellSettings.header.collapseButton.visible}
          onClose={closeMobileSidebar}
          onToggleCollapse={toggleSidebarCollapse}
        />
        <div className="gvaMainColumn">
          {shellSettings.tab.visible ? (
            <TagsView
              tabMode={shellSettings.tab.mode}
              showTabIcon={shellSettings.tab.showIcon}
            />
          ) : null}
          {isMobileSidebarOpen ? (
            <div className="sidebarBackdrop" role="presentation" onClick={closeMobileSidebar} />
          ) : null}
          <div className="appContent gvaAppContent">
            {/* 对齐 GVA：#gva-base-load-dom + .gva-body-h，页脚在其外，切换时不上跳 */}
            <div id="gva-base-load-dom" className="gvaBodyH">
              <GvaRouteLoadingEffects />
              <main className="pageContent gvaPageContent">
                {isLoading && !user ? (
                  <div className="adminLoading">加载中…</div>
                ) : (
                  <GvaPageTransition pageKey={pathname} name={shellSettings.page.transition}>
                    <Suspense fallback={<div className="adminLoading">加载中…</div>}>
                      {children}
                    </Suspense>
                  </GvaPageTransition>
                )}
              </main>
            </div>
            <BottomInfo className="gvaLayoutFooter" />
          </div>
        </div>
      </div>
      {shellSettings.watermark.visible ? (
        <div className="gvaWatermark" aria-hidden="true">
          {Array.from({ length: 24 }, (_, index) => (
            <span key={index}>Gin-Vue-Admin</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
