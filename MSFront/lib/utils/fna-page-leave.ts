/**
 * 命令式离场：导航前把当前页克隆到 body 播放。
 * 克隆必须挂 body，否则 React reconcile 会清掉。
 */
import { readFnaShellSettings, type FnaPageTransition } from '@/lib/utils/fna-shell-settings';

export const FNA_LEAVE_DURATIONS: Record<Exclude<FnaPageTransition, 'none'>, number> = {
  fade: 300,
  slide: 300,
  zoom: 500,
};

type LeaveEndListener = () => void;

const leaveEndListeners = new Set<LeaveEndListener>();
let activeLeave: {
  clone: HTMLElement;
  live: HTMLElement | null;
  timer: number;
} | null = null;

export function subscribeFnaPageLeaveEnd(listener: LeaveEndListener) {
  leaveEndListeners.add(listener);
  return () => {
    leaveEndListeners.delete(listener);
  };
}

export function isFnaPageLeaving() {
  return activeLeave !== null;
}

export function resetFnaPageLeave() {
  if (activeLeave) {
    window.clearTimeout(activeLeave.timer);
    activeLeave.clone.remove();
    restoreLive(activeLeave.live);
    activeLeave = null;
  }
  document.querySelectorAll('.fnaPageLeaveClone, .fnaPageLeaveClip').forEach((node) => node.remove());
  restoreLive(document.getElementById('fna-page-live'));
}

function restoreLive(live: HTMLElement | null) {
  if (!live?.isConnected) {
    return;
  }
  live.style.visibility = '';
  live.style.pointerEvents = '';
  live.style.opacity = '';
}

function notifyLeaveEnd() {
  for (const listener of leaveEndListeners) {
    listener();
  }
}

function finishLeave() {
  if (!activeLeave) {
    return;
  }
  const { clone, timer } = activeLeave;
  window.clearTimeout(timer);
  activeLeave = null;

  clone.remove();
  // 保持 live 隐藏，等 startEnter 挂上 is-enter 再揭开
  notifyLeaveEnd();

  window.setTimeout(() => {
    const live = document.getElementById('fna-page-live');
    if (live?.style.visibility === 'hidden') {
      restoreLive(live);
    }
  }, 100);
}

export function triggerFnaPageLeave() {
  if (typeof document === 'undefined') {
    return false;
  }

  const transition = readFnaShellSettings().page.transition;
  if (transition === 'none') {
    return false;
  }

  const live = document.getElementById('fna-page-live');
  if (!live?.closest('.fnaPageTransitionStage')) {
    return false;
  }

  if (activeLeave) {
    window.clearTimeout(activeLeave.timer);
    activeLeave.clone.remove();
    restoreLive(activeLeave.live);
    activeLeave = null;
  }

  const rect = live.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  const clipHost =
    (live.closest('.fnaAppContent') as HTMLElement | null) ??
    (live.closest('.fnaMainColumn') as HTMLElement | null) ??
    (live.closest('#fna-base-load-dom') as HTMLElement | null);
  const clipRect = clipHost?.getBoundingClientRect() ?? rect;

  const clip = document.createElement('div');
  clip.className = 'fnaPageLeaveClip';
  clip.setAttribute('aria-hidden', 'true');
  clip.style.cssText = [
    'position:fixed',
    `left:${clipRect.left}px`,
    `top:${rect.top}px`,
    `width:${clipRect.width}px`,
    `height:${rect.height}px`,
    'overflow:hidden',
    'z-index:1200',
    'pointer-events:none',
  ].join(';');

  const clone = live.cloneNode(true) as HTMLElement;
  clone.removeAttribute('id');
  clone.className = `fnaPageTransition fnaPageLeaveClone fnaPage-${transition} is-leave`;
  clone.style.cssText = [
    'position:absolute',
    `left:${rect.left - clipRect.left}px`,
    'top:0',
    `width:${rect.width}px`,
    `height:${rect.height}px`,
    'margin:0',
    'pointer-events:none',
    'box-sizing:border-box',
  ].join(';');

  clip.appendChild(clone);
  document.body.appendChild(clip);

  live.style.visibility = 'hidden';
  live.style.pointerEvents = 'none';

  void clone.offsetWidth;

  const duration = FNA_LEAVE_DURATIONS[transition];
  const timer = window.setTimeout(finishLeave, duration + 48);

  activeLeave = { clone: clip, live, timer };

  clone.addEventListener(
    'animationend',
    (event) => {
      if (event.target === clone) {
        finishLeave();
      }
    },
    { once: true },
  );

  return true;
}
