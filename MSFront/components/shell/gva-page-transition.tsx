'use client';

import { useState, type AnimationEvent, type ReactNode } from 'react';
import type { GvaPageTransition } from '@/lib/utils/gva-shell-settings';

const ENTER_ANIMATIONS = new Set(['gva-fade-in', 'gva-slide-in', 'gva-zoom-in']);

export function GvaPageTransition({
  name,
  children,
}: {
  name: GvaPageTransition;
  children: ReactNode;
}) {
  const [entering, setEntering] = useState(name !== 'none');

  if (name === 'none') {
    return children;
  }

  function handleAnimationEnd(event: AnimationEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || !ENTER_ANIMATIONS.has(event.animationName)) {
      return;
    }
    setEntering(false);
  }

  return (
    <div
      className={`gvaPageTransition gvaPage-${name}${entering ? ' is-enter' : ''}`}
      onAnimationEnd={handleAnimationEnd}
    >
      {children}
    </div>
  );
}
