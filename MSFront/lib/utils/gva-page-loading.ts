type GvaPageLoadingListener = () => void;

const CONTENT_LOADING_DELAY_MS = 400;
const FORCE_CLOSE_MS = 30_000;

let activeRequests = 0;
let contentVisible = false;
let routeProgressVisible = false;
let showTimer: ReturnType<typeof setTimeout> | null = null;
let forceCloseTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<GvaPageLoadingListener>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function clearTimers() {
  if (showTimer) {
    clearTimeout(showTimer);
    showTimer = null;
  }
  if (forceCloseTimer) {
    clearTimeout(forceCloseTimer);
    forceCloseTimer = null;
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
      emit();
    }
  }, FORCE_CLOSE_MS);
}

export function subscribeGvaPageLoading(listener: GvaPageLoadingListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getGvaContentLoadingVisible() {
  return contentVisible;
}

export function getGvaRouteProgressVisible() {
  return routeProgressVisible;
}

/** GVA request.js：超过 400ms 才在内容区显示 loading */
export function beginGvaContentLoading(delayMs = CONTENT_LOADING_DELAY_MS) {
  activeRequests += 1;
  clearTimers();
  showTimer = setTimeout(() => {
    if (activeRequests > 0 && !contentVisible) {
      contentVisible = true;
      emit();
    }
    scheduleForceClose();
  }, delayMs);
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
  clearTimers();
  if (contentVisible) {
    contentVisible = false;
    emit();
  }
}

export function resetGvaContentLoading() {
  activeRequests = 0;
  clearTimers();
  if (contentVisible) {
    contentVisible = false;
    emit();
  }
}

/** GVA NProgress：路由切换立即显示顶栏进度 */
export function beginGvaRouteProgress() {
  if (!routeProgressVisible) {
    routeProgressVisible = true;
    emit();
  }
}

export function endGvaRouteProgress() {
  if (routeProgressVisible) {
    routeProgressVisible = false;
    emit();
  }
  resetGvaContentLoading();
}

export const GVA_CONTENT_LOADING_DELAY_MS = CONTENT_LOADING_DELAY_MS;
