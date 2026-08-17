import type { CSSProperties } from 'react';
import type { ProjectEnvironment, ProjectStatus } from '@/lib/types/management';
import { environmentTone, statusTone } from '@/lib/utils/format';

interface StatusBadgeProps {
  label: string;
  type: 'status' | 'environment';
  value: ProjectStatus | ProjectEnvironment;
}

export function StatusBadge({ label, type, value }: StatusBadgeProps) {
  const tone = type === 'status' ? statusTone(value as ProjectStatus) : environmentTone(value as ProjectEnvironment);

  return (
    <span
      style={{ '--badge-tone': tone } as CSSProperties}
      className="statusBadge"
    >
      {label}
    </span>
  );
}
