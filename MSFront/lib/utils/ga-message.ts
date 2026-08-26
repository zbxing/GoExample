/**
 * 对齐 gin-vue-admin / Element Plus ElMessage：
 * - plain: true（白底阴影）
 * - grouping: false（多条独立堆叠）
 * - 垂直偏移：首条 offset，其后间距 16px，top 过渡 0.4s
 * - 进出场：message-fade（opacity + translateY）
 * - 关闭时立刻从堆叠中移除（对齐 EP instances.splice），下方同步上顶；离场条冻结原 top
 */

export type GvaMessageType = 'success' | 'error' | 'warning' | 'info';

export interface GvaMessageOptions {
  type?: GvaMessageType;
  message: string;
  duration?: number;
  plain?: boolean;
  /** 首条相对视口顶部的偏移，默认 20（对齐 el-message CSS） */
  offset?: number;
}

export interface GvaMessageItem {
  id: string;
  type: GvaMessageType;
  message: string;
  duration: number;
  plain: boolean;
  offset: number;
  closing: boolean;
  height: number;
  /** 开始离场时冻结的 top，离场期间不再参与堆叠 */
  frozenTop?: number;
}

type Listener = () => void;

const DEFAULT_DURATION = 3000;
const DEFAULT_OFFSET = 20;
const LEAVE_MS = 400;

let seed = 1;
/** SSR / 水合用稳定空列表，避免 useSyncExternalStore getServerSnapshot 每次新建 [] 死循环 */
const EMPTY_MESSAGES: GvaMessageItem[] = [];
let items: GvaMessageItem[] = EMPTY_MESSAGES;
const listeners = new Set<Listener>();
const closeTimers = new Map<string, number>();
const leaveTimers = new Map<string, number>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function clearTimer(map: Map<string, number>, id: string) {
  const timer = map.get(id);
  if (timer) {
    window.clearTimeout(timer);
    map.delete(id);
  }
}

function replaceItems(next: GvaMessageItem[]) {
  items = next.length === 0 ? EMPTY_MESSAGES : next;
}

export function getGvaMessages() {
  return items;
}

export function getGvaMessagesServerSnapshot() {
  return EMPTY_MESSAGES;
}

export function subscribeGvaMessages(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setGvaMessageHeight(id: string, height: number) {
  const next = items.map((item) => (item.id === id ? { ...item, height } : item));
  if (next.some((item, index) => item.height !== items[index]?.height)) {
    replaceItems(next);
    emit();
  }
}

/** 计算每条消息的 top（对齐 EP getLastOffset + getOffsetOrSpace） */
export function getGvaMessageTops(list: GvaMessageItem[]) {
  const tops = new Map<string, number>();
  let lastBottom = 0;
  let stackIndex = 0;

  for (const item of list) {
    // 离场中：不占堆叠位（等同 EP 立刻从 instances 移除），保持冻结 top 做离场动画
    if (item.closing) {
      tops.set(item.id, item.frozenTop ?? item.offset);
      continue;
    }

    const gapOrOffset = stackIndex > 0 ? 16 : item.offset;
    const top = gapOrOffset + lastBottom;
    tops.set(item.id, top);
    lastBottom = top + Math.max(item.height, 0);
    stackIndex += 1;
  }

  return tops;
}

export function closeGvaMessage(id: string) {
  clearTimer(closeTimers, id);
  const target = items.find((item) => item.id === id);
  if (!target || target.closing) {
    return;
  }

  const frozenTop = getGvaMessageTops(items).get(id) ?? target.offset;
  replaceItems(
    items.map((item) =>
      item.id === id ? { ...item, closing: true, frozenTop } : item,
    ),
  );
  emit();

  clearTimer(leaveTimers, id);
  leaveTimers.set(
    id,
    window.setTimeout(() => {
      leaveTimers.delete(id);
      replaceItems(items.filter((item) => item.id !== id));
      emit();
    }, LEAVE_MS),
  );
}

export function showGvaMessage(options: GvaMessageOptions | string) {
  if (typeof window === 'undefined') {
    return { close: () => undefined };
  }

  const normalized: GvaMessageOptions =
    typeof options === 'string' ? { message: options } : options;

  const id = `gva_msg_${seed++}`;
  const item: GvaMessageItem = {
    id,
    type: normalized.type ?? 'info',
    message: normalized.message,
    duration: normalized.duration ?? DEFAULT_DURATION,
    plain: normalized.plain ?? true,
    offset: normalized.offset ?? DEFAULT_OFFSET,
    closing: false,
    height: 0,
  };

  replaceItems([...items, item]);
  emit();

  if (item.duration > 0) {
    closeTimers.set(
      id,
      window.setTimeout(() => {
        closeTimers.delete(id);
        closeGvaMessage(id);
      }, item.duration),
    );
  }

  return {
    close: () => closeGvaMessage(id),
  };
}

showGvaMessage.success = (message: string, duration?: number) =>
  showGvaMessage({ type: 'success', message, duration });
showGvaMessage.error = (message: string, duration?: number) =>
  showGvaMessage({ type: 'error', message, duration });
showGvaMessage.warning = (message: string, duration?: number) =>
  showGvaMessage({ type: 'warning', message, duration });
showGvaMessage.info = (message: string, duration?: number) =>
  showGvaMessage({ type: 'info', message, duration });
