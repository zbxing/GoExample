'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

interface FnaScrollbarProps {
  children: ReactNode;
  className?: string;
}

/**
 * 对齐 Element Plus `el-scrollbar`：
 * - 隐藏原生滚动条（含箭头）
 * - 右侧 6px 滑块绝对定位，不占用内容宽度
 * - 鼠标进入容器时显示，离开后消失
 */
export function FnaScrollbar({ children, className }: FnaScrollbarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startTop: number } | null>(null);
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [thumb, setThumb] = useState({ height: 0, top: 0, needed: false });

  const updateThumb = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = wrap;
    const needed = scrollHeight > clientHeight + 1;
    if (!needed) {
      setThumb({ height: 0, top: 0, needed: false });
      return;
    }
    const track = Math.max(clientHeight - 4, 0);
    const height = Math.max((clientHeight / scrollHeight) * track, 20);
    const maxTop = Math.max(track - height, 0);
    const top =
      scrollHeight === clientHeight
        ? 0
        : (scrollTop / (scrollHeight - clientHeight)) * maxTop;
    setThumb({ height, top, needed: true });
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) {
      return;
    }
    updateThumb();
    const observer = new ResizeObserver(() => {
      updateThumb();
    });
    observer.observe(wrap);
    if (wrap.firstElementChild) {
      observer.observe(wrap.firstElementChild);
    }
    return () => observer.disconnect();
  }, [updateThumb, children]);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const drag = dragRef.current;
      const wrap = wrapRef.current;
      if (!drag || !wrap) {
        return;
      }
      const { scrollHeight, clientHeight } = wrap;
      const track = Math.max(clientHeight - 4, 0);
      const thumbHeight = Math.max((clientHeight / scrollHeight) * track, 20);
      const maxTop = Math.max(track - thumbHeight, 0);
      const nextTop = Math.min(Math.max(drag.startTop + (event.clientY - drag.startY), 0), maxTop);
      const maxScroll = scrollHeight - clientHeight;
      wrap.scrollTop = maxTop === 0 ? 0 : (nextTop / maxTop) * maxScroll;
    }

    function onPointerUp() {
      dragRef.current = null;
      setDragging(false);
      const root = rootRef.current;
      if (root && !root.matches(':hover')) {
        setHover(false);
      }
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  function handleThumbPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { startY: event.clientY, startTop: thumb.top };
    setDragging(true);
    thumbRef.current?.setPointerCapture?.(event.pointerId);
  }

  const showBar = thumb.needed && (hover || dragging);
  const rootClass = [
    'fnaScrollbar',
    className,
    hover ? 'is-hover' : '',
    dragging ? 'is-dragging' : '',
    showBar ? 'is-bar-visible' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={rootRef}
      className={rootClass}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        if (!dragRef.current) {
          setHover(false);
        }
      }}
    >
      <div ref={wrapRef} className="fnaScrollbarWrap" onScroll={updateThumb}>
        {children}
      </div>
      <div
        className={thumb.needed ? 'fnaScrollbarBar is-vertical is-needed' : 'fnaScrollbarBar is-vertical'}
        aria-hidden="true"
      >
        <div
          ref={thumbRef}
          className="fnaScrollbarThumb"
          style={{ height: `${thumb.height}px`, transform: `translateY(${thumb.top}px)` }}
          onPointerDown={handleThumbPointerDown}
        />
      </div>
    </div>
  );
}
