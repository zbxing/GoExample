'use client';

import { useState, type ReactNode } from 'react';

interface FnaMorphButtonProps {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  title?: string;
  spinning?: boolean;
}

export function FnaMorphButton({
  icon,
  label,
  onClick,
  title,
  spinning,
}: FnaMorphButtonProps) {
  const [hovered, setHovered] = useState(false);
  const expanded = hovered;

  return (
    <button
      type="button"
      className="fnaMorphBtn"
      title={title ?? label}
      aria-label={label}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="fnaMorphInner">
        <span className={expanded ? 'fnaMorphIconCol is-collapsed' : 'fnaMorphIconCol'}>
          <span className="fnaMorphIconClip">
            <span
              className={
                spinning
                  ? 'fnaMorphIconFace fnaSpin'
                  : expanded
                    ? 'fnaMorphIconFace is-out'
                    : 'fnaMorphIconFace'
              }
            >
              {icon}
            </span>
          </span>
        </span>
        <span className={expanded ? 'fnaMorphLabelCol is-expanded' : 'fnaMorphLabelCol'}>
          <span className="fnaMorphLabelClip">
            <span className={expanded ? 'fnaMorphLabelFace is-in' : 'fnaMorphLabelFace'}>
              {label}
            </span>
          </span>
        </span>
      </span>
    </button>
  );
}
