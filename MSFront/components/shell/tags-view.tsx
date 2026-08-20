'use client';

import Link from 'next/link';
import { createElement, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import type { Route } from 'next';
import { useAuth } from '@/providers/auth-provider';
import { flattenMenuTree } from '@/lib/utils/menu-access';
import { resolveMenuIcon } from '@/lib/utils/menu-icons';
import { beginGvaContentLoading, beginGvaRouteProgress } from '@/lib/utils/gva-page-loading';
import { triggerGvaPageLeave } from '@/lib/utils/gva-page-leave';

interface TagsViewItem {
  path: string;
  title: string;
  closable: boolean;
  icon?: string;
}

const HOME_TAB: TagsViewItem = {
  path: '/dashboard',
  title: '仪表盘',
  closable: false,
  icon: 'LayoutDashboard',
};

const SERVER_SNAPSHOT: TagsViewItem[] = [HOME_TAB];
const storageKey = 'msfront:gva-tags';
const listeners = new Set<() => void>();

let cachedClientSnapshot: TagsViewItem[] = SERVER_SNAPSHOT;
let cachedClientRaw: string | null = null;

function emitStorage() {
  for (const listener of listeners) {
    listener();
  }
}

function tagsEqual(a: TagsViewItem[], b: TagsViewItem[]) {
  return (
    a.length === b.length &&
    a.every(
      (item, index) =>
        item.path === b[index]?.path &&
        item.title === b[index]?.title &&
        item.icon === b[index]?.icon &&
        item.closable === b[index]?.closable,
    )
  );
}

function normalizeTags(parsed: unknown): TagsViewItem[] {
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return SERVER_SNAPSHOT;
  }
  return parsed as TagsViewItem[];
}

function readStoredTags(): TagsViewItem[] {
  if (typeof window === 'undefined') {
    return SERVER_SNAPSHOT;
  }

  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (raw === cachedClientRaw) {
      return cachedClientSnapshot;
    }

    cachedClientRaw = raw;
    const next = raw ? normalizeTags(JSON.parse(raw)) : SERVER_SNAPSHOT;
    if (tagsEqual(next, cachedClientSnapshot)) {
      return cachedClientSnapshot;
    }

    cachedClientSnapshot = next;
    return cachedClientSnapshot;
  } catch {
    cachedClientRaw = null;
    cachedClientSnapshot = SERVER_SNAPSHOT;
    return cachedClientSnapshot;
  }
}

function persistTags(next: TagsViewItem[]) {
  if (typeof window === 'undefined') {
    return;
  }

  const payload = JSON.stringify(next);
  window.sessionStorage.setItem(storageKey, payload);
  cachedClientRaw = payload;
  cachedClientSnapshot = next;
  emitStorage();
}

function subscribeTags(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getServerSnapshot() {
  return SERVER_SNAPSHOT;
}

function ensureTag(
  current: TagsViewItem[],
  pathname: string,
  title: string,
  icon?: string,
): TagsViewItem[] {
  const exists = current.some((item) => item.path === pathname);
  if (exists) {
    return current.map((item) =>
      item.path === pathname ? { ...item, title, icon: icon ?? item.icon } : item,
    );
  }
  return [
    ...current,
    {
      path: pathname,
      title,
      icon,
      closable: pathname !== HOME_TAB.path,
    },
  ];
}

function ChromeTabBg({ symbolId }: { symbolId: string }) {
  return (
    <svg className="gvaChromeSvg" aria-hidden="true">
      <svg width="51%" height="100%">
        <use href={`#${symbolId}`} width="214" height="100%" fill="currentColor" />
      </svg>
      <g transform="scale(-1, 1)">
        <svg x="-100%" y="0" width="51%" height="100%">
          <use href={`#${symbolId}`} width="214" height="100%" fill="currentColor" />
        </svg>
      </g>
    </svg>
  );
}

export function TagsView({
  tabMode = 'chrome',
  showTabIcon = true,
}: {
  tabMode?: 'chrome' | 'button' | 'slider';
  showTabIcon?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { menus } = useAuth();
  const tags = useSyncExternalStore(subscribeTags, readStoredTags, getServerSnapshot);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [rightTarget, setRightTarget] = useState<string | null>(null);

  const metaMap = useMemo(() => {
    const map = new Map<string, { title: string; icon?: string }>([
      [HOME_TAB.path, { title: HOME_TAB.title, icon: HOME_TAB.icon }],
    ]);
    for (const menu of flattenMenuTree(menus)) {
      if (menu.path.startsWith('/')) {
        map.set(menu.path, { title: menu.title, icon: menu.icon });
      }
    }
    map.set('/403', { title: '无权限' });
    map.set('/settings', { title: '系统设置', icon: 'Settings' });
    return map;
  }, [menus]);

  const meta = metaMap.get(pathname) ?? { title: pathname };

  useEffect(() => {
    if (!pathname || pathname === '/login') {
      return;
    }
    const next = ensureTag(tags, pathname, meta.title, meta.icon);
    if (tagsEqual(next, tags)) {
      return;
    }
    persistTags(next);
  }, [tags, pathname, meta.title, meta.icon]);

  function navigateTo(path: string) {
    if (pathname === path) {
      return;
    }
    const leaving = triggerGvaPageLeave();
    beginGvaRouteProgress();
    // 离场约 300ms；延迟 loading 避免白膜盖住旧页滑出
    beginGvaContentLoading(leaving ? 360 : 400);
    router.push(path as Route);
  }

  function closeTag(path: string) {
    const index = tags.findIndex((item) => item.path === path);
    if (index < 0 || !tags[index].closable) {
      return;
    }
    const next = tags.filter((item) => item.path !== path);
    persistTags(next.length ? next : SERVER_SNAPSHOT);
    if (pathname === path) {
      const fallback = next[index] ?? next[index - 1] ?? HOME_TAB;
      navigateTo(fallback.path);
    }
  }

  function closeAll() {
    persistTags(SERVER_SNAPSHOT);
    navigateTo(HOME_TAB.path);
    setMenuOpen(false);
  }

  function closeOthers() {
    if (!rightTarget) {
      return;
    }
    const keep = tags.find((item) => item.path === rightTarget) ?? HOME_TAB;
    const next =
      keep.path === HOME_TAB.path ? SERVER_SNAPSHOT : [HOME_TAB, { ...keep, closable: true }];
    const unique = next.filter(
      (item, idx, arr) => arr.findIndex((candidate) => candidate.path === item.path) === idx,
    );
    persistTags(unique);
    navigateTo(keep.path);
    setMenuOpen(false);
  }

  function closeRight() {
    if (!rightTarget) {
      return;
    }
    const index = tags.findIndex((item) => item.path === rightTarget);
    if (index < 0) {
      return;
    }
    const next = tags.slice(0, index + 1);
    persistTags(next);
    if (!next.some((item) => item.path === pathname)) {
      navigateTo(next[next.length - 1].path);
    }
    setMenuOpen(false);
  }

  function closeLeft() {
    if (!rightTarget) {
      return;
    }
    const index = tags.findIndex((item) => item.path === rightTarget);
    if (index < 0) {
      return;
    }
    const right = tags[index];
    const next = [HOME_TAB, ...(right.path === HOME_TAB.path ? [] : [right])].filter(
      (item, idx, arr) => arr.findIndex((candidate) => candidate.path === item.path) === idx,
    );
    persistTags(next);
    if (!next.some((item) => item.path === pathname)) {
      navigateTo(right.path);
    }
    setMenuOpen(false);
  }

  return (
    <div className={`gvaTagsView gvaTabs-${tabMode}`} data-tab-mode={tabMode}>
      <svg width="0" height="0" className="gvaChromeDefs" aria-hidden="true">
        <defs>
          <symbol id="gva-chrome-geometry-left" viewBox="0 0 214 36" preserveAspectRatio="none">
            <path d="M17 0h197v36H0v-2c4.5 0 9-3.5 9-8V8c0-4.5 3.5-8 8-8z" />
          </symbol>
        </defs>
      </svg>
      <div className="gvaTagsScroll">
        {tags.map((tag) => {
          const active = pathname === tag.path;
          const Icon = tag.icon ? resolveMenuIcon(tag.icon) : null;
          return (
            <div
              key={tag.path}
              className={
                active
                  ? `gvaPageTab gvaPageTab-${tabMode} is-active`
                  : `gvaPageTab gvaPageTab-${tabMode}`
              }
              onClick={() => {
                navigateTo(tag.path);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setRightTarget(tag.path);
                setMenuPos({ x: event.clientX, y: event.clientY });
                setMenuOpen(true);
              }}
              onMouseDown={(event) => {
                if (event.button !== 1 || !tag.closable) {
                  return;
                }
                event.preventDefault();
                closeTag(tag.path);
              }}
            >
              {tabMode === 'chrome' ? (
                <>
                  <div className="gvaChromeBg" aria-hidden="true">
                    <ChromeTabBg symbolId="gva-chrome-geometry-left" />
                  </div>
                  <div className="gvaChromeHover" aria-hidden="true" />
                </>
              ) : null}

              {showTabIcon && Icon
                ? createElement(Icon, { size: 16, className: 'gvaPageTabIcon' })
                : null}

              <Link
                href={tag.path as Route}
                className="gvaPageTabLabel"
                onClick={(event) => event.preventDefault()}
              >
                {tag.title}
              </Link>

              {tag.closable ? (
                <button
                  type="button"
                  className="gvaPageTabClose"
                  aria-label={`关闭 ${tag.title}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    closeTag(tag.path);
                  }}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <X size={12} />
                </button>
              ) : null}

              {tabMode === 'chrome' ? <div className="gvaChromeDivider" aria-hidden="true" /> : null}
            </div>
          );
        })}
      </div>

      {menuOpen ? (
        <>
          <button
            type="button"
            className="gvaTagsMenuBackdrop"
            aria-label="关闭菜单"
            onClick={() => setMenuOpen(false)}
          />
          <div
            className="gvaTagsContextMenu"
            style={{ left: menuPos.x, top: menuPos.y }}
            role="menu"
          >
            <button type="button" onClick={closeAll}>
              关闭所有
            </button>
            <button type="button" onClick={closeLeft}>
              关闭左侧
            </button>
            <button type="button" onClick={closeRight}>
              关闭右侧
            </button>
            <button type="button" onClick={closeOthers}>
              关闭其他
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
