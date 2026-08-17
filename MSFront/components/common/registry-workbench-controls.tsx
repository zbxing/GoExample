'use client';

import type { ReactNode } from 'react';
import { ManagementContextStrip } from '@/components/common/management-primitives';

interface RegistryWorkbenchControlsProps {
  contextLabel: string;
  contextTags: readonly string[];
  contextActions?: ReactNode;
  filters: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function RegistryWorkbenchControls({
  contextLabel,
  contextTags,
  contextActions,
  filters,
  footer,
  className = 'portfolioWorkbench',
}: RegistryWorkbenchControlsProps) {
  return (
    <div className={className}>
      <ManagementContextStrip
        label={contextLabel}
        tags={contextTags}
        actions={contextActions}
      />
      {filters}
      {footer ? <div className="accessActionBar">{footer}</div> : null}
    </div>
  );
}
