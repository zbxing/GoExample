'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import {
  beginGvaRouteProgress,
  endGvaRouteProgress,
  getGvaContentLoadingVisible,
  getGvaRouteProgressBarTranslatePercent,
  getGvaRouteProgressEasing,
  getGvaRouteProgressSnapHidden,
  getGvaRouteProgressSpeedMs,
  getGvaRouteProgressVisible,
  subscribeGvaPageLoading,
} from '@/lib/utils/gva-page-loading';
import { readGvaShellSettings, subscribeGvaShellSettings } from '@/lib/utils/gva-shell-settings';
import { triggerGvaPageLeave } from '@/lib/utils/gva-page-leave';

function isInternalDashboardHref(href: string, currentPath: string) {
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
    return false;
  }
  try {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) {
      return false;
    }
    if (url.pathname === currentPath && url.search === window.location.search) {
      return false;
    }
    if (url.pathname === '/login' || url.pathname.startsWith('/login/')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 对齐 GVA permission.js + nprogress@0.2.0：
 * - beforeEach → NProgress.start()
 * - afterEach → NProgress.done()
 * - configure({ showSpinner: false, ease: 'ease', speed: 500 })
 */
export function GvaRouteLoadingEffects() {
  const pathname = usePathname();
  const contentVisible = useSyncExternalStore(
    subscribeGvaPageLoading,
    getGvaContentLoadingVisible,
    () => false,
  );
  const progressVisible = useSyncExternalStore(
    subscribeGvaPageLoading,
    getGvaRouteProgressVisible,
    () => false,
  );
  const barTranslate = useSyncExternalStore(
    subscribeGvaPageLoading,
    getGvaRouteProgressBarTranslatePercent,
    () => -100,
  );
  const snapHidden = useSyncExternalStore(
    subscribeGvaPageLoading,
    getGvaRouteProgressSnapHidden,
    () => false,
  );
  const showProgress = useSyncExternalStore(
    subscribeGvaShellSettings,
    () => readGvaShellSettings().tab.showProgress,
    () => true,
  );
  const speedMs = useSyncExternalStore(
    subscribeGvaPageLoading,
    getGvaRouteProgressSpeedMs,
    () => 500,
  );
  const easing = useSyncExternalStore(
    subscribeGvaPageLoading,
    getGvaRouteProgressEasing,
    () => 'ease',
  );

  // afterEach → done()
  useEffect(() => {
    endGvaRouteProgress();
  }, [pathname]);

  // 关闭「展示进度条」时立刻收起当前进度
  useEffect(() => {
    if (!showProgress) {
      endGvaRouteProgress(true);
    }
  }, [showProgress]);

  // beforeEach → start()
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target as Element | null;
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) {
        return;
      }
      const href = anchor.getAttribute('href');
      if (!href || !isInternalDashboardHref(href, pathname)) {
        return;
      }
      const leaving = triggerGvaPageLeave();
      if (readGvaShellSettings().tab.showProgress) {
        beginGvaRouteProgress();
      }
      void leaving;
    }

    document.addEventListener('click', onPointerDown, true);
    return () => document.removeEventListener('click', onPointerDown, true);
  }, [pathname]);

  const barTransition = snapHidden ? 'all 0ms linear' : `all ${speedMs}ms ${easing}`;

  return (
    <>
      {progressVisible && showProgress ? (
        <div className="gvaRouteProgress is-active" aria-hidden="true">
          <div
            className="gvaRouteProgressBar"
            style={{
              transform: `translate3d(${barTranslate}%, 0, 0)`,
              transition: barTransition,
            }}
          >
            <div className="gvaRouteProgressPeg" />
          </div>
        </div>
      ) : null}
      {contentVisible ? (
        <div className="gvaContentLoading" role="status" aria-live="polite" aria-busy="true">
          <span className="gvaContentLoadingSpinner" aria-hidden="true" />
          <span>加载中</span>
        </div>
      ) : null}
    </>
  );
}
