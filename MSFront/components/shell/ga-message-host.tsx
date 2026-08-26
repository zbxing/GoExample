'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Check, CircleAlert, Info, TriangleAlert } from 'lucide-react';
import {
  getGvaMessageTops,
  getGvaMessages,
  getGvaMessagesServerSnapshot,
  setGvaMessageHeight,
  subscribeGvaMessages,
  type GvaMessageItem,
  type GvaMessageType,
} from '@/lib/utils/ga-message';

function MessageIcon({ type }: { type: GvaMessageType }) {
  if (type === 'success') {
    return <Check size={10} strokeWidth={3} />;
  }
  if (type === 'error') {
    return <CircleAlert size={12} strokeWidth={2.5} />;
  }
  if (type === 'warning') {
    return <TriangleAlert size={12} strokeWidth={2.5} />;
  }
  return <Info size={12} strokeWidth={2.5} />;
}

function GvaMessageCard({ item, top }: { item: GvaMessageItem; top: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setEntered(true));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const update = () => setGvaMessageHeight(item.id, el.getBoundingClientRect().height);
    update();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [item.id, item.message]);

  const phaseClass = item.closing
    ? 'is-leave-active'
    : entered
      ? 'is-enter-active'
      : 'is-enter-from';

  return (
    <div
      ref={ref}
      className={[
        'gvaMessage',
        `gvaMessage-${item.type}`,
        item.plain ? 'is-plain' : '',
        phaseClass,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ top }}
      role="status"
    >
      <span className="gvaMessageIcon" aria-hidden="true">
        <MessageIcon type={item.type} />
      </span>
      <p className="gvaMessageContent">{item.message}</p>
    </div>
  );
}

export function GvaMessageHost() {
  // getServerSnapshot 必须返回缓存引用，内联 () => [] 每次新数组会触发无限更新
  const messages = useSyncExternalStore(
    subscribeGvaMessages,
    getGvaMessages,
    getGvaMessagesServerSnapshot,
  );
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || typeof document === 'undefined') {
    return null;
  }

  const tops = getGvaMessageTops(messages);

  return createPortal(
    <div className="gvaMessageHost" aria-live="polite">
      {messages.map((item) => (
        <GvaMessageCard key={item.id} item={item} top={tops.get(item.id) ?? item.offset} />
      ))}
    </div>,
    document.body,
  );
}
