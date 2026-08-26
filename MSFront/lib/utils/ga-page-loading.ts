import { readGvaShellSettings } from '@/lib/utils/ga-shell-settings';

type GvaPageLoadingListener = () => void;

const CONTENT_LOADING_DELAY_MS = 400;
const FORCE_CLOSE_MS = 30_000;

/**
 * 对齐 gin-vue-admin `permission.js`：
 * Nprogress.configure({ showSpinner: false, ease: 'ease', speed: 500 })
 * 算法对齐 nprogress@0.2.0
 */
const NP = {
  minimum: 0.08,
  easing: 'ease',
  speed: 500,
  trickle: true,
  trickleRate: 0.02,
  trickleSpeed: 800,
} as const;

let activeRequests = 0;
let contentVisible = false;
let listAwaiting = false;

/** NProgress.status：进行中为 0..1；null 表示未开始或已进入 done 收尾 */
let progressStatus: number | null = null;
/** 实际渲染用的 0..1（done 收尾时 status 已为 null） */
let progressDisplay = 0;
let progressMounted = false;
let progressOpacity = 1;
let progressSnapHidden = false;
/** 递增以作废排队中的 setTimeout / queue 回调 */
let progressGeneration = 0;

let trickleTimer: ReturnType<typeof setTimeout> | null = null;
let finishHoldTimer: ReturnType<typeof setTimeout> | null = null;
let showTimer: ReturnType<typeof setTimeout> | null = null;
let forceCloseTimer: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<GvaPageLoadingListener>();
const setQueue: Array<() => void> = [];
let setQueueRunning = false;

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function clamp(n: number, min: number, max: number) {
  if (n < min) {
    return min;
  }
  if (n > max) {
    return max;
  }
  return n;
}

function clearContentTimers() {
  if (showTimer) {
    clearTimeout(showTimer);
    showTimer = null;
  }
  if (forceCloseTimer) {
    clearTimeout(forceCloseTimer);
    forceCloseTimer = null;
  }
}

function clearTrickle() {
  if (trickleTimer) {
    clearTimeout(trickleTimer);
    trickleTimer = null;
  }
}

function clearFinishTimers() {
  if (finishHoldTimer) {
    clearTimeout(finishHoldTimer);
    finishHoldTimer = null;
  }
}

function flushSetQueue() {
  progressGeneration += 1;
  setQueue.length = 0;
  setQueueRunning = false;
}

function enqueueSet(work: (next: () => void) => void) {
  const gen = progressGeneration;
  setQueue.push(() => {
    if (gen !== progressGeneration) {
      return;
    }
    work(() => {
      if (gen !== progressGeneration) {
        return;
      }
      setQueue.shift();
      const nextJob = setQueue[0];
      if (nextJob) {
        nextJob();
      } else {
        setQueueRunning = false;
      }
    });
  });
  if (!setQueueRunning) {
    setQueueRunning = true;
    setQueue[0]?.();
  }
}

function scheduleForceClose() {
  if (!contentVisible || activeRequests <= 0) {
    return;
  }
  forceCloseTimer = setTimeout(() => {
    if (contentVisible && activeRequests > 0) {
      activeRequests = 0;
      contentVisible = false;
      listAwaiting = false;
      emit();
    }
  }, FORCE_CLOSE_MS);
}

function toBarTranslatePercent(n: number) {
  return (-1 + n) * 100;
}

function applyProgressVisual(n: number, fromStart: boolean) {
  const gen = progressGeneration;
  progressMounted = true;
  progressOpacity = 1;
  progressDisplay = n;
  progressSnapHidden = fromStart;
  emit();

  if (fromStart && typeof window !== 'undefined') {
    window.requestAnimationFrame(() => {
      if (gen !== progressGeneration) {
        return;
      }
      progressSnapHidden = false;
      emit();
    });
  }
}

/** 进行中的 set（start / trickle），不用于 done 收尾 */
function setProgress(n: number) {
  const started = typeof progressStatus === 'number';
  const next = clamp(n, NP.minimum, 0.994);
  const fromStart = !started;
  progressStatus = next;

  const gen = progressGeneration;
  enqueueSet((done) => {
    if (gen !== progressGeneration) {
      return;
    }
    applyProgressVisual(next, fromStart);
    window.setTimeout(() => {
      if (gen !== progressGeneration) {
        return;
      }
      done();
    }, NP.speed);
  });
}

function incProgress(amount?: number) {
  const n = progressStatus;
  if (typeof n !== 'number') {
    // 收尾中或未开始：禁止 trickle 把进度条重新拉起来
    return;
  }
  let step = amount;
  if (typeof step !== 'number') {
    step = (1 - n) * clamp(Math.random() * n, 0.1, 0.95);
  }
  setProgress(clamp(n + step, 0, 0.994));
}

function startTrickleLoop() {
  if (!NP.trickle) {
    return;
  }
  clearTrickle();
  const gen = progressGeneration;
  const work = () => {
    trickleTimer = setTimeout(() => {
      trickleTimer = null;
      if (gen !== progressGeneration || typeof progressStatus !== 'number') {
        return;
      }
      incProgress(Math.random() * NP.trickleRate);
      work();
    }, NP.trickleSpeed);
  };
  work();
}

export function subscribeGvaPageLoading(listener: GvaPageLoadingListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getGvaContentLoadingVisible() {
  return contentVisible || listAwaiting;
}

export function getGvaRouteProgressVisible() {
  return progressMounted;
}

export function getGvaRouteProgressStatus() {
  if (!progressMounted) {
    return 0;
  }
  return progressDisplay;
}

export function getGvaRouteProgressOpacity() {
  return progressMounted ? progressOpacity : 0;
}

export function getGvaRouteProgressSnapHidden() {
  return progressSnapHidden;
}

export function getGvaRouteProgressSpeedMs() {
  return NP.speed;
}

export function getGvaRouteProgressEasing() {
  return NP.easing;
}

export function getGvaRouteProgressBarTranslatePercent() {
  if (progressSnapHidden) {
    return -100;
  }
  return toBarTranslatePercent(getGvaRouteProgressStatus());
}

export function getGvaActiveRequestCount() {
  return activeRequests;
}

export function beginGvaListAwaiting() {
  if (!listAwaiting) {
    listAwaiting = true;
    emit();
  }
}

export function endGvaListAwaiting() {
  if (!listAwaiting) {
    return;
  }
  listAwaiting = false;
  emit();
}

export function beginGvaContentLoading(delayMs = CONTENT_LOADING_DELAY_MS) {
  activeRequests += 1;
  emit();
  clearContentTimers();
  const effectiveDelay = listAwaiting ? 0 : delayMs;
  showTimer = setTimeout(() => {
    if (activeRequests > 0 && !contentVisible) {
      contentVisible = true;
      emit();
    }
    scheduleForceClose();
  }, effectiveDelay);
}

export function endGvaContentLoading() {
  activeRequests = Math.max(0, activeRequests - 1);
  if (activeRequests > 0) {
    if (forceCloseTimer) {
      clearTimeout(forceCloseTimer);
      forceCloseTimer = null;
    }
    scheduleForceClose();
    return;
  }
  clearContentTimers();
  listAwaiting = false;
  if (contentVisible) {
    contentVisible = false;
    emit();
  } else {
    emit();
  }
}

export function resetGvaContentLoading() {
  activeRequests = 0;
  listAwaiting = false;
  clearContentTimers();
  if (contentVisible) {
    contentVisible = false;
    emit();
  }
}

/** GVA beforeEach → NProgress.start() */
export function beginGvaRouteProgress() {
  if (!readGvaShellSettings().tab.showProgress) {
    return;
  }
  clearTrickle();
  clearFinishTimers();
  if (typeof progressStatus !== 'number') {
    flushSetQueue();
    progressOpacity = 1;
    progressSnapHidden = false;
    setProgress(0);
  }
  startTrickleLoop();
}

/**
 * GVA afterEach → NProgress.done()
 * 路由已完成后立刻收尾：丢掉 start 队列积压，马上 placebo 抬升 → 100% → 停留 speed → 直接移除。
 */
export function endGvaRouteProgress(force = false) {
  if (!force && typeof progressStatus !== 'number') {
    return;
  }
  if (force && typeof progressStatus !== 'number') {
    clearTrickle();
    clearFinishTimers();
    flushSetQueue();
    progressStatus = null;
    progressMounted = false;
    progressOpacity = 1;
    progressDisplay = 0;
    progressSnapHidden = false;
    emit();
    return;
  }

  const gen = progressGeneration + 1;
  clearTrickle();
  clearFinishTimers();
  flushSetQueue();
  progressGeneration = gen;

  const bumped = clamp((progressStatus ?? NP.minimum) + 0.3 + 0.5 * Math.random(), 0, 0.994);
  progressStatus = null;
  progressMounted = true;
  progressOpacity = 1;
  progressSnapHidden = false;
  progressDisplay = bumped;
  emit();

  if (typeof window === 'undefined') {
    progressDisplay = 1;
    progressMounted = false;
    emit();
    return;
  }

  window.requestAnimationFrame(() => {
    if (gen !== progressGeneration) {
      return;
    }
    progressDisplay = 1;
    emit();

    finishHoldTimer = setTimeout(() => {
      finishHoldTimer = null;
      if (gen !== progressGeneration) {
        return;
      }
      progressMounted = false;
      progressOpacity = 1;
      progressDisplay = 0;
      progressSnapHidden = false;
      emit();
    }, NP.speed);
  });
}

/** @deprecated */
export function getGvaRouteProgressPercent() {
  return getGvaRouteProgressStatus() * 100;
}

export function getGvaRouteProgressFromStart() {
  return progressSnapHidden;
}

export const GVA_CONTENT_LOADING_DELAY_MS = CONTENT_LOADING_DELAY_MS;
