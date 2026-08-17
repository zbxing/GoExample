import type { PropsWithChildren } from 'react';
import { Suspense } from 'react';
import { DashboardShell } from '@/components/shell/dashboard-shell';

export default function DashboardLayout({ children }: PropsWithChildren) {
  return (
    <Suspense fallback={<div className="adminLoading">加载中...</div>}>
      <DashboardShell>{children}</DashboardShell>
    </Suspense>
  );
}
