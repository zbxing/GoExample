'use client';

import { RotateCcw } from 'lucide-react';
import { WorkbenchResultsBar } from '@/components/common/workbench-results-bar';

interface SecurityFiltersWorkbenchResultsBarContentProps {
  copyLabel: string;
  onCopy: () => void;
  onReset: () => void;
  resetLabel: string;
  summaryTags: readonly string[];
}

export function SecurityFiltersWorkbenchResultsBarContent({
  copyLabel,
  onCopy,
  onReset,
  resetLabel,
  summaryTags,
}: SecurityFiltersWorkbenchResultsBarContentProps) {
  return (
    <WorkbenchResultsBar
      tags={summaryTags.map((tag) => ({ label: tag }))}
      actions={
        <>
          <button type="button" className="ghostButton" onClick={onCopy}>
            {copyLabel}
          </button>
          <button type="button" className="ghostButton" onClick={onReset}>
            <RotateCcw size={14} />
            {resetLabel}
          </button>
        </>
      }
    />
  );
}
