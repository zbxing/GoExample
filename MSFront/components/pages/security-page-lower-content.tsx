'use client';

import type { ComponentProps } from 'react';
import { SecurityPageResultsContent } from '@/components/pages/security-page-results-content';
import { SecurityPageWorkbenchContent } from '@/components/pages/security-page-workbench-content';

interface SecurityPageLowerContentProps {
  resultsProps: ComponentProps<typeof SecurityPageResultsContent>;
  workbenchProps: ComponentProps<typeof SecurityPageWorkbenchContent>;
}

export function SecurityPageLowerContent({
  resultsProps,
  workbenchProps,
}: SecurityPageLowerContentProps) {
  return (
    <>
      <SecurityPageWorkbenchContent {...workbenchProps} />
      <SecurityPageResultsContent {...resultsProps} />
    </>
  );
}
