'use client';

import type { ReactNode } from 'react';

interface ResultsWorkbenchControlsProps {
  filters: ReactNode;
  resultsBar: ReactNode;
  className?: string;
}

export function ResultsWorkbenchControls({
  filters,
  resultsBar,
  className = 'portfolioWorkbench',
}: ResultsWorkbenchControlsProps) {
  return (
    <div className={className}>
      {filters}
      {resultsBar}
    </div>
  );
}
