'use client';

import { createElement, Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import type { Route } from 'next';
import { useAuth } from '@/providers/auth-provider';
import { flattenMenuTree } from '@/lib/utils/menu-access';
import { resolveMenuIcon } from '@/lib/utils/menu-icons';
import { beginGvaRouteProgress } from '@/lib/utils/gva-page-loading';
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
  const items = (parsed as TagsViewItem[]).map((item) =>
    item.path === HOME_TAB.path ? { ...item, closable: false } : item,
  );
  return normalizeTagOrder(items);
}

/** 无关闭按钮的标签固定在最左侧，其余保持相对顺序 */
function normalizeTagOrder(current: TagsViewItem[]): TagsViewItem[] {
  const pinned = current.filter((item) => !item.closable);
  const rest = current.filter((item) => item.closable);
  const next = [...pinned, ...rest];
  return tagsEqual(next, current) ? current : next;
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

  const normalized = normalizeTagOrder(next);
  const payload = JSON.stringify(normalized);
  window.sessionStorage.setItem(storageKey, payload);
  cachedClientRaw = payload;
  cachedClientSnapshot = normalized;
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

interface TabRect {
  left: number;
  top: number;
  width: number;
  height: number;
  marginRight: number;
  /** 该标签在 flex 布局中向前推进的距离（含 gap / 负 margin），用于重排后计算真实 left */
  slotAdvance: number;
}

function overlapX(aLeft: number, aRight: number, bLeft: number, bRight: number): number {
  return Math.max(0, Math.min(aRight, bRight) - Math.max(aLeft, bLeft));
}

/** 将 fromIdx 处的项移动到 insertAt（原始数组「插入到该下标前」语义） */
function moveToIndex(items: TagsViewItem[], fromIdx: number, insertAt: number): TagsViewItem[] {
  if (fromIdx < 0 || insertAt < 0 || fromIdx === insertAt) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(fromIdx, 1);
  const to = insertAt > fromIdx ? insertAt - 1 : insertAt;
  next.splice(to, 0, moved);
  return next;
}

function captureTabRects(
  items: TagsViewItem[],
  tabEls: Map<string, HTMLDivElement>,
): Map<string, TabRect> {
  const measured: Array<{
    path: string;
    left: number;
    top: number;
    width: number;
    height: number;
    marginRight: number;
  }> = [];

  for (const item of items) {
    const el = tabEls.get(item.path);
    if (!el) {
      continue;
    }
    const rect = el.getBoundingClientRect();
    const marginRight = Number.parseFloat(window.getComputedStyle(el).marginRight) || 0;
    measured.push({
      path: item.path,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      marginRight,
    });
  }

  const rects = new Map<string, TabRect>();
  for (let i = 0; i < measured.length; i++) {
    const current = measured[i];
    const next = measured[i + 1];
    let slotAdvance: number;
    if (next) {
      // 非末项：相邻 left 差已包含 gap / 负 margin
      slotAdvance = next.left - current.left;
    } else if (i > 0) {
      // 末项：复用与前一项之间的间距，避免宽度不同时重排后少算一段 gap
      const prev = measured[i - 1];
      const spacing = current.left - prev.left - prev.width;
      slotAdvance = current.width + spacing;
    } else {
      slotAdvance = current.width + current.marginRight;
    }
    rects.set(current.path, {
      left: current.left,
      top: current.top,
      width: current.width,
      height: current.height,
      marginRight: current.marginRight,
      slotAdvance,
    });
  }
  return rects;
}

/**
 * 按重排后的顺序，用各标签自己的 slotAdvance 累加出真实目标 left。
 * 不能直接用「原下标槽位的 left」：相邻标签宽度不同时会偏。
 */
function getReorderedLefts(
  items: TagsViewItem[],
  fromIdx: number,
  insertAt: number,
  rects: Map<string, TabRect>,
): Map<string, number> {
  const reordered = moveToIndex(items, fromIdx, insertAt);
  const originLeft = items[0] ? rects.get(items[0].path)?.left : undefined;
  let cursor = originLeft ?? 0;
  const result = new Map<string, number>();
  for (const item of reordered) {
    result.set(item.path, cursor);
    const advance = rects.get(item.path)?.slotAdvance ?? rects.get(item.path)?.width ?? 0;
    cursor += advance;
  }
  return result;
}

/**
 * 基于拖拽开始时的位置快照判断重叠，避免让位动画反馈导致来回切换。
 * - 与某标签重叠 ≥50%：交换到该位置
 * - 与原始槽位重叠 ≥50%：回到起始位置
 * - 否则：保持当前插入位置（不自动回弹）
 */
function computeInsertIndex(
  ghostLeft: number,
  ghostWidth: number,
  items: TagsViewItem[],
  dragPath: string,
  rects: Map<string, TabRect>,
  currentInsert: number,
): number {
  const fromIdx = items.findIndex((item) => item.path === dragPath);
  if (fromIdx < 0) {
    return 0;
  }

  const pinnedCount = items.filter((item) => !item.closable).length;
  const ghostRight = ghostLeft + ghostWidth;
  const clamp = (value: number) => Math.max(pinnedCount, Math.min(value, items.length));

  const originRect = rects.get(dragPath);
  if (originRect) {
    const homeOverlap = overlapX(
      ghostLeft,
      ghostRight,
      originRect.left,
      originRect.left + originRect.width,
    );
    if (homeOverlap >= originRect.width * 0.5) {
      return clamp(fromIdx);
    }
  }

  let bestIdx = -1;
  let bestRatio = 0;

  for (let i = 0; i < items.length; i++) {
    if (i === fromIdx) {
      continue;
    }
    const rect = rects.get(items[i].path);
    if (!rect || rect.width <= 0) {
      continue;
    }
    const overlap = overlapX(ghostLeft, ghostRight, rect.left, rect.left + rect.width);
    const ratio = overlap / rect.width;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestIdx = i;
    }
  }

  if (bestRatio < 0.5) {
    return clamp(currentInsert);
  }

  const insertAt = bestIdx < fromIdx ? bestIdx : bestIdx + 1;
  return clamp(insertAt);
}

/** 拖拽中：非拖动项根据重排后真实目标 left 与快照 left 计算平移量 */
function getTabShiftX(
  index: number,
  fromIdx: number,
  insertAt: number,
  items: TagsViewItem[],
  rects: Map<string, TabRect>,
): number {
  if (index === fromIdx || insertAt === fromIdx) {
    return 0;
  }
  const path = items[index]?.path;
  if (!path) {
    return 0;
  }
  const currentLeft = rects.get(path)?.left;
  if (currentLeft === undefined) {
    return 0;
  }

  const targetLeft = getReorderedLefts(items, fromIdx, insertAt, rects).get(path);
  if (targetLeft === undefined) {
    return 0;
  }
  return targetLeft - currentLeft;
}

/** 松手后拖拽标签应收拢到的水平位置（按重排后真实占位累加） */
function getDropTargetLeft(
  items: TagsViewItem[],
  dragPath: string,
  fromIdx: number,
  insertAt: number,
  rects: Map<string, TabRect>,
): number | null {
  if (insertAt === fromIdx) {
    return rects.get(dragPath)?.left ?? null;
  }
  return getReorderedLefts(items, fromIdx, insertAt, rects).get(dragPath) ?? null;
}

const TAB_SHIFT_MS = 250;

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
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [insertIndex, setInsertIndex] = useState<number | null>(null);
  const [dragGhost, setDragGhost] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [isSettling, setIsSettling] = useState(false);
  const [settleAnim, setSettleAnim] = useState<{
    anchorLeft: number;
    translateX: number;
  } | null>(null);
  const [settlingAnim, setSettlingAnim] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const dragRef = useRef<{
    path: string;
    fromIdx: number;
    anchorTop: number;
    startX: number;
    startY: number;
    offsetX: number;
    width: number;
    height: number;
    marginRight: number;
    slotAdvance: number;
    active: boolean;
  } | null>(null);
  const baseTagsRef = useRef<TagsViewItem[]>(tags);
  const frozenActivePathRef = useRef<string | null>(null);
  const insertIndexRef = useRef<number | null>(null);
  const tabRectsRef = useRef<Map<string, TabRect>>(new Map());
  const tabRefs = useRef(new Map<string, HTMLDivElement>());
  const tagsRef = useRef(tags);
  const pathnameRef = useRef(pathname);
  const navigateRef = useRef<(path: string) => void>(() => {});
  const settleTimerRef = useRef<number | null>(null);
  const isSettlingRef = useRef(false);
  const settleFinalizedRef = useRef(false);
  const dragGhostRef = useRef(dragGhost);
  const beginSettleDropRef = useRef<(insertAt: number) => void>(() => {});
  /** 主动关闭的路径：在路由尚未离开前禁止 ensureTag 再把它加回来 */
  const suppressEnsurePathsRef = useRef(new Set<string>());

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    tagsRef.current = tags;
  }, [tags]);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    isSettlingRef.current = isSettling;
  }, [isSettling]);

  useEffect(() => {
    dragGhostRef.current = dragGhost;
  }, [dragGhost]);

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

    // 路由已离开被关闭的路径后，解除抑制
    for (const closedPath of [...suppressEnsurePathsRef.current]) {
      if (closedPath !== pathname) {
        suppressEnsurePathsRef.current.delete(closedPath);
      }
    }

    // 关闭当前标签后 router.push 完成前，pathname 仍是旧路径；此时不可再 ensure 回去
    if (suppressEnsurePathsRef.current.has(pathname)) {
      return;
    }

    const next = ensureTag(tags, pathname, meta.title, meta.icon);
    if (tagsEqual(next, tags)) {
      return;
    }
    persistTags(next);
  }, [tags, pathname, meta.title, meta.icon]);

  function suppressEnsureForRemoved(previous: TagsViewItem[], next: TagsViewItem[]) {
    for (const item of previous) {
      if (!next.some((candidate) => candidate.path === item.path)) {
        suppressEnsurePathsRef.current.add(item.path);
      }
    }
  }

  function commitTags(next: TagsViewItem[]) {
    const normalized = next.length ? next : SERVER_SNAPSHOT;
    suppressEnsureForRemoved(tagsRef.current, normalized);
    persistTags(normalized);
  }

  function navigateTo(path: string) {
    if (pathname === path) {
      return;
    }
    const leaving = triggerGvaPageLeave();
    beginGvaRouteProgress();
    // 内容区 loading 只由 apiFetch 驱动（对齐 GVA），导航处不再 begin，避免无 end 卡住
    void leaving;
    router.push(path as Route);
  }

  navigateRef.current = navigateTo;

  const dragTags = draggingPath ? baseTagsRef.current : tags;
  const dragFromIdx =
    draggingPath && insertIndex !== null
      ? dragTags.findIndex((item) => item.path === draggingPath)
      : -1;

  function resetDragVisuals() {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    setDraggingPath(null);
    setInsertIndex(null);
    setDragGhost(null);
    setIsSettling(false);
    setSettlingAnim(false);
    setSettleAnim(null);
    isSettlingRef.current = false;
    frozenActivePathRef.current = null;
    insertIndexRef.current = null;
    tabRectsRef.current = new Map();
    for (const el of tabRefs.current.values()) {
      el.style.willChange = 'auto';
      el.style.backfaceVisibility = '';
      el.style.transition = 'none';
      el.style.transform = '';
      el.style.transition = '';
    }
  }

  function completeDrop(fromIdx: number, insertAt: number) {
    const next = moveToIndex(baseTagsRef.current, fromIdx, insertAt);
    for (const el of tabRefs.current.values()) {
      el.style.willChange = 'auto';
      el.style.backfaceVisibility = '';
    }
    flushSync(() => {
      if (!tagsEqual(next, tagsRef.current)) {
        persistTags(next);
      }
      resetDragVisuals();
    });
    dragRef.current = null;
    settleFinalizedRef.current = false;
  }

  function finishSettleDrop(fromIdx: number, insertAt: number) {
    if (settleFinalizedRef.current) {
      return;
    }
    settleFinalizedRef.current = true;
    completeDrop(fromIdx, insertAt);
  }

  function beginSettleDrop(insertAt: number) {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }

    const targetLeft = getDropTargetLeft(
      baseTagsRef.current,
      drag.path,
      drag.fromIdx,
      insertAt,
      tabRectsRef.current,
    );
    const resolvedTarget = targetLeft === null ? null : Math.round(targetLeft);
    const anchorLeft = Math.round(dragGhostRef.current?.left ?? resolvedTarget ?? 0);

    if (resolvedTarget === null || resolvedTarget - anchorLeft === 0) {
      completeDrop(drag.fromIdx, insertAt);
      return;
    }

    const deltaX = resolvedTarget - anchorLeft;

    flushSync(() => {
      setIsSettling(true);
      isSettlingRef.current = true;
      setSettlingAnim(false);
      setSettleAnim({ anchorLeft, translateX: 0 });
    });

    settleTimerRef.current = window.setTimeout(() => {
      finishSettleDrop(drag.fromIdx, insertAt);
    }, TAB_SHIFT_MS + 80);

    requestAnimationFrame(() => {
      setSettlingAnim(true);
      setSettleAnim({ anchorLeft, translateX: deltaX });
    });
  }

  beginSettleDropRef.current = beginSettleDrop;

  useEffect(() => {
    function onMouseMove(event: MouseEvent) {
      const drag = dragRef.current;
      if (!drag || isSettlingRef.current) {
        return;
      }

      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.active && Math.hypot(dx, dy) > 5) {
        drag.active = true;
        baseTagsRef.current = tagsRef.current;
        const rects = captureTabRects(baseTagsRef.current, tabRefs.current);
        tabRectsRef.current = rects;
        const dragRect = rects.get(drag.path);
        if (dragRect) {
          drag.slotAdvance = dragRect.slotAdvance;
          drag.width = dragRect.width;
          drag.height = dragRect.height;
          drag.anchorTop = dragRect.top;
          drag.marginRight = dragRect.marginRight;
        }
        frozenActivePathRef.current = pathnameRef.current;
        insertIndexRef.current = drag.fromIdx;
        setDraggingPath(drag.path);
        setInsertIndex(drag.fromIdx);
        setMenuOpen(false);
        document.body.style.cursor = 'pointer';
        setDragGhost({
          left: event.clientX - drag.offsetX,
          top: drag.anchorTop,
          width: drag.width,
          height: drag.height,
        });
      }
      if (!drag.active) {
        return;
      }

      const ghostLeft = event.clientX - drag.offsetX;

      setDragGhost({
        left: ghostLeft,
        top: drag.anchorTop,
        width: drag.width,
        height: drag.height,
      });

      const nextInsert = computeInsertIndex(
        ghostLeft,
        drag.width,
        baseTagsRef.current,
        drag.path,
        tabRectsRef.current,
        insertIndexRef.current ?? drag.fromIdx,
      );
      if (nextInsert !== insertIndexRef.current) {
        insertIndexRef.current = nextInsert;
        setInsertIndex(nextInsert);
      }
    }

    function onMouseUp() {
      const drag = dragRef.current;
      if (!drag || isSettlingRef.current) {
        return;
      }

      document.body.style.userSelect = '';
      document.body.style.cursor = '';

      if (drag.active) {
        const insertAt = insertIndexRef.current ?? drag.fromIdx;
        beginSettleDropRef.current(insertAt);
        return;
      }

      navigateRef.current(drag.path);
      dragRef.current = null;
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
    };
  }, []);

  function closeTag(path: string) {
    const index = tags.findIndex((item) => item.path === path);
    if (index < 0 || !tags[index].closable) {
      return;
    }
    const next = tags.filter((item) => item.path !== path);
    commitTags(next.length ? next : SERVER_SNAPSHOT);
    if (pathname === path) {
      const fallback = next[index] ?? next[index - 1] ?? HOME_TAB;
      navigateTo(fallback.path);
    }
  }

  function closeAll() {
    commitTags(SERVER_SNAPSHOT);
    navigateTo(HOME_TAB.path);
    setMenuOpen(false);
  }

  function closeOthers() {
    if (!rightTarget) {
      return;
    }
    const keep = tags.find((item) => item.path === rightTarget) ?? HOME_TAB;
    const pinned = tags.filter((item) => !item.closable);
    const next =
      !keep.closable
        ? normalizeTagOrder(pinned)
        : normalizeTagOrder([...pinned, { ...keep, closable: true }]).filter(
            (item, idx, arr) => arr.findIndex((candidate) => candidate.path === item.path) === idx,
          );
    commitTags(next.length ? next : SERVER_SNAPSHOT);
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
    const next = normalizeTagOrder(tags.slice(0, index + 1));
    commitTags(next);
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
    // 保留固定标签，以及右键目标及其右侧标签；只关掉左侧可关闭标签
    const next = normalizeTagOrder(
      tags.filter((item, itemIndex) => !item.closable || itemIndex >= index),
    );
    commitTags(next.length ? next : SERVER_SNAPSHOT);
    if (!next.some((item) => item.path === pathname)) {
      navigateTo(tags[index].path);
    }
    setMenuOpen(false);
  }

  return (
    <div
      className={`gvaTagsView gvaTabs-${tabMode}${draggingPath ? ' is-dragging-tabs' : ''}`}
      data-tab-mode={tabMode}
    >
      <svg width="0" height="0" className="gvaChromeDefs" aria-hidden="true">
        <defs>
          <symbol id="gva-chrome-geometry-left" viewBox="0 0 214 36" preserveAspectRatio="none">
            <path d="M17 0h197v36H0v-2c4.5 0 9-3.5 9-8V8c0-4.5 3.5-8 8-8z" />
          </symbol>
        </defs>
      </svg>
      <div className="gvaTagsScroll">
        {dragTags.map((tag, index) => {
          const active = draggingPath
            ? frozenActivePathRef.current === tag.path
            : pathname === tag.path;
          const Icon = tag.icon ? resolveMenuIcon(tag.icon) : null;
          const draggable = tag.closable;
          const isDragging = draggingPath === tag.path;
          const shiftX =
            draggingPath && insertIndex !== null && dragFromIdx >= 0 && !isDragging
              ? getTabShiftX(
                  index,
                  dragFromIdx,
                  insertIndex,
                  dragTags,
                  tabRectsRef.current,
                )
              : 0;
          const roundedShiftX = Math.round(shiftX);
          const isShifting = draggingPath && !isDragging;
          const isShiftingActive = isShifting && roundedShiftX !== 0;
          const ghostLeft =
            isDragging && isSettling && settleAnim
              ? settleAnim.anchorLeft
              : dragGhost?.left ?? 0;
          const ghostTransform =
            isDragging && isSettling && settlingAnim && settleAnim && settleAnim.translateX !== 0
              ? `translate3d(${Math.round(settleAnim.translateX)}px, 0, 0)`
              : undefined;
          return (
            <Fragment key={tag.path}>
              {isDragging && dragGhost ? (
                <div
                  className="gvaPageTabPlaceholder"
                  style={{
                    // 占位用标签自身宽 + margin，保留父级 gap；slotAdvance 含 gap 不能当 width
                    width: dragGhost.width,
                    height: dragGhost.height,
                    marginRight: dragRef.current?.marginRight ?? 0,
                    flexShrink: 0,
                  }}
                  aria-hidden="true"
                />
              ) : null}
              <div
              ref={(el) => {
                if (el) {
                  tabRefs.current.set(tag.path, el);
                } else {
                  tabRefs.current.delete(tag.path);
                }
              }}
              data-tab-path={tag.path}
              data-tab-pinned={tag.closable ? undefined : 'true'}
              className={[
                'gvaPageTab',
                `gvaPageTab-${tabMode}`,
                active ? 'is-active' : '',
                draggable ? 'is-draggable' : 'is-pinned',
                isDragging ? 'is-dragging' : '',
                isDragging && isSettling && settlingAnim ? 'is-settling-anim' : '',
                isShifting ? 'is-shifting' : '',
                isShiftingActive ? 'is-shifting-active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                ...(isDragging && dragGhost
                  ? {
                      position: 'fixed',
                      left: ghostLeft,
                      top: dragGhost.top,
                      width: dragGhost.width,
                      height: dragGhost.height,
                      zIndex: 4000,
                      opacity: 1,
                      ...(ghostTransform ? { transform: ghostTransform } : {}),
                    }
                  : undefined),
                ...(isShiftingActive
                  ? { transform: `translate3d(${roundedShiftX}px, 0, 0)` }
                  : undefined),
              }}
              onTransitionEnd={(event) => {
                if (
                  !isDragging ||
                  !settlingAnim ||
                  event.propertyName !== 'transform' ||
                  event.currentTarget !== event.target
                ) {
                  return;
                }
                const drag = dragRef.current;
                if (!drag) {
                  return;
                }
                const insertAt = insertIndexRef.current ?? drag.fromIdx;
                finishSettleDrop(drag.fromIdx, insertAt);
              }}
              onClick={() => {
                if (!draggable) {
                  navigateTo(tag.path);
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setRightTarget(tag.path);
                setMenuPos({ x: event.clientX, y: event.clientY });
                setMenuOpen(true);
              }}
              onMouseDown={(event) => {
                if (event.button === 1 && tag.closable) {
                  event.preventDefault();
                  closeTag(tag.path);
                  return;
                }
                if (event.button !== 0 || !draggable) {
                  return;
                }
                if ((event.target as HTMLElement).closest('.gvaPageTabClose')) {
                  return;
                }
                const tabEl = event.currentTarget;
                const rect = tabEl.getBoundingClientRect();
                const fromIdx = tagsRef.current.findIndex((item) => item.path === tag.path);
                const marginRight =
                  Number.parseFloat(window.getComputedStyle(tabEl).marginRight) || 0;
                // 禁止浏览器把内部文本拖成 URL/文字幽灵图
                event.preventDefault();
                document.body.style.userSelect = 'none';
                dragRef.current = {
                  path: tag.path,
                  fromIdx,
                  anchorTop: rect.top,
                  startX: event.clientX,
                  startY: event.clientY,
                  offsetX: event.clientX - rect.left,
                  width: rect.width,
                  height: rect.height,
                  marginRight,
                  slotAdvance: rect.width + marginRight,
                  active: false,
                };
              }}
              draggable={false}
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

              <span className="gvaPageTabLabel">{tag.title}</span>

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
            </Fragment>
          );
        })}
      </div>

      {menuOpen && portalReady
        ? createPortal(
            <>
              <button
                type="button"
                className="gvaTagsMenuBackdrop"
                aria-label="关闭菜单"
                onClick={() => setMenuOpen(false)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenuOpen(false);
                }}
              />
              <div
                className="gvaTagsContextMenu"
                style={{ left: menuPos.x, top: menuPos.y }}
                role="menu"
              >
                <button type="button" role="menuitem" onClick={closeAll}>
                  关闭所有
                </button>
                <button type="button" role="menuitem" onClick={closeLeft}>
                  关闭左侧
                </button>
                <button type="button" role="menuitem" onClick={closeRight}>
                  关闭右侧
                </button>
                <button type="button" role="menuitem" onClick={closeOthers}>
                  关闭其他
                </button>
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
