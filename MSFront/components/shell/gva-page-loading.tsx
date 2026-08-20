'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import {
  beginGvaContentLoading,
  beginGvaRouteProgress,
  endGvaRouteProgress,
  getGvaContentLoadingVisible,
  getGvaRouteProgressVisible,
  subscribeGvaPageLoading,
} from '@/lib/utils/gva-page-loading';
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

/** 监听站内跳转：立即顶栏进度，超过 400ms 内容区 loading（对齐 GVA） */
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

  useEffect(() => {
    endGvaRouteProgress();
  }, [pathname]);

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
      beginGvaRouteProgress();
      beginGvaContentLoading(leaving ? 360 : 400);
    }

    document.addEventListener('click', onPointerDown, true);
    return () => document.removeEventListener('click', onPointerDown, true);
  }, [pathname]);

  return (
    <>
      <div
        className={progressVisible ? 'gvaRouteProgress is-active' : 'gvaRouteProgress'}
        aria-hidden="true"
      />
      {contentVisible ? (
        <div className="gvaContentLoading" role="status" aria-live="polite" aria-busy="true">
          <span className="gvaContentLoadingSpinner" aria-hidden="true" />
          <span>加载中</span>
        </div>
      ) : null}
    </>
  );
}
