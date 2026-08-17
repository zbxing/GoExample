'use client';

import {
  SecurityPageResultsShell,
  type SecurityPageResultsShellProps,
} from '@/components/pages/security-page-results-shell';

export function SecurityPageResultsContent({
  ...props
}: SecurityPageResultsShellProps) {
  return <SecurityPageResultsShell {...props} />;
}
