'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { FnaPageTransition as TransitionName } from '@/lib/utils/fna-shell-settings';
import {
  FNA_LEAVE_DURATIONS,
  isFnaPageLeaving,
  subscribeFnaPageLeaveEnd,
} from '@/lib/utils/fna-page-leave';

/**
 * 进场 class 必须由 React className 驱动。
 * 之前用 classList.add('is-enter') 会被后续 render 的 className 覆盖掉，看起来就像没动画。
 */
export function FnaPageTransition({
  name,
  pageKey,
  children,
}: {
  name: TransitionName;
  pageKey: string;
  children: ReactNode;
}) {
  const liveRef = useRef<HTMLDivElement>(null);
  const pageKeyRef = useRef(pageKey);
  const nameRef = useRef(name);
  nameRef.current = name;

  const [enterToken, setEnterToken] = useState(0);
  const [entering, setEntering] = useState(false);

  function startEnter() {
    const transition = nameRef.current;
    if (transition === 'none') {
      return;
    }
    const live = liveRef.current ?? document.getElementById('fna-page-live');
    if (live) {
      live.style.visibility = '';
      live.style.pointerEvents = '';
      live.style.opacity = '';
    }
    // 换 token 让带 is-enter 的节点重新挂载，动画必定从头播
    flushSync(() => {
      setEnterToken((token) => token + 1);
      setEntering(true);
    });
  }

  // 离场克隆移除后播进场
  useEffect(() => {
    if (name === 'none') {
      return;
    }
    return subscribeFnaPageLeaveEnd(() => {
      window.requestAnimationFrame(() => {
        startEnter();
      });
    });
  }, [name]);

  // 无离场时的路由变化（前进/后退）
  useEffect(() => {
    if (pageKey === pageKeyRef.current) {
      return;
    }
    pageKeyRef.current = pageKey;

    if (name === 'none' || isFnaPageLeaving()) {
      return;
    }

    window.requestAnimationFrame(() => {
      startEnter();
    });
  }, [pageKey, name]);

  useEffect(() => {
    if (!entering || name === 'none') {
      return;
    }
    const timer = window.setTimeout(() => setEntering(false), FNA_LEAVE_DURATIONS[name] + 32);
    return () => window.clearTimeout(timer);
  }, [entering, enterToken, name]);

  if (name === 'none') {
    return (
      <div className="fnaPageTransitionStage">
        <div id="fna-page-live" ref={liveRef}>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="fnaPageTransitionStage">
      <div id="fna-page-live" ref={liveRef}>
        <div
          key={enterToken}
          className={[
            'fnaPageTransition',
            `fnaPage-${name}`,
            entering ? 'is-enter' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
