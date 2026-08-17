'use client';

import { useState, type ReactNode } from 'react';

interface GvaMorphButtonProps {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  title?: string;
  spinning?: boolean;
}

export function GvaMorphButton({
  icon,
  label,
  onClick,
  title,
  spinning,
}: GvaMorphButtonProps) {
  const [hovered, setHovered] = useState(false);
  const expanded = hovered;

  return (
    <button
      type="button"
      className="gvaMorphBtn"
      title={title ?? label}
      aria-label={label}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="gvaMorphInner">
        <span className={expanded ? 'gvaMorphIconCol is-collapsed' : 'gvaMorphIconCol'}>
          <span className="gvaMorphIconClip">
            <span
              className={
                spinning
                  ? 'gvaMorphIconFace gvaSpin'
                  : expanded
                    ? 'gvaMorphIconFace is-out'
                    : 'gvaMorphIconFace'
              }
            >
              {icon}
            </span>
          </span>
        </span>
        <span className={expanded ? 'gvaMorphLabelCol is-expanded' : 'gvaMorphLabelCol'}>
          <span className="gvaMorphLabelClip">
            <span className={expanded ? 'gvaMorphLabelFace is-in' : 'gvaMorphLabelFace'}>
              {label}
            </span>
          </span>
        </span>
      </span>
    </button>
  );
}
