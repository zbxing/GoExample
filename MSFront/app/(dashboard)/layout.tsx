import type { PropsWithChildren } from 'react';
import { DashboardShell } from '@/components/shell/dashboard-shell';

export default function DashboardLayout({ children }: PropsWithChildren) {
  // Suspense 不能包住整壳：换页 suspend 时会卸掉旧页，离场动画无法播放。
  // 页面级 Suspense 放在 DashboardShell 内容区内。
  return <DashboardShell>{children}</DashboardShell>;
}
