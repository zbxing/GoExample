'use client';

import { useEffect, useState } from 'react';
import { AdminCard, AdminPage } from '@/components/admin/admin-primitives';

type ServerMetrics = {
  os: string;
  arch: string;
  goVersion: string;
  cpu: number;
  memUsed: number;
  memTotal: number;
  diskUsed: number;
  diskTotal: number;
  goroutines: number;
  uptime: string;
};

function nextMetrics(prev: ServerMetrics | null): ServerMetrics {
  const cpu = Math.min(96, Math.max(8, (prev?.cpu ?? 32) + (Math.random() * 10 - 5)));
  const memUsed = Math.min(
    15.2,
    Math.max(4.5, (prev?.memUsed ?? 7.2) + (Math.random() * 0.6 - 0.3)),
  );
  const diskUsed = prev?.diskUsed ?? 128.4;
  return {
    os: 'windows',
    arch: 'amd64',
    goVersion: 'go1.24.x',
    cpu: Number(cpu.toFixed(1)),
    memUsed: Number(memUsed.toFixed(1)),
    memTotal: 16,
    diskUsed,
    diskTotal: 512,
    goroutines: Math.round(180 + Math.random() * 40),
    uptime: prev?.uptime ?? '3d 14h 22m',
  };
}

export function ServerStatePage() {
  const [metrics, setMetrics] = useState<ServerMetrics>(() => nextMetrics(null));

  useEffect(() => {
    const timer = window.setInterval(() => {
      setMetrics((current) => nextMetrics(current));
    }, 3000);
    return () => window.clearInterval(timer);
  }, []);

  const memPct = Math.round((metrics.memUsed / metrics.memTotal) * 100);
  const diskPct = Math.round((metrics.diskUsed / metrics.diskTotal) * 100);

  return (
    <AdminPage>
      <div className="fnaMetricGrid">
        <div className="fnaMetricCard">
          <div className="label">CPU 使用率</div>
          <div className="value">{metrics.cpu}%</div>
          <div className="fnaProgressTrack">
            <div className="fnaProgressBar" style={{ width: `${metrics.cpu}%` }} />
          </div>
        </div>
        <div className="fnaMetricCard">
          <div className="label">内存</div>
          <div className="value">
            {metrics.memUsed}/{metrics.memTotal} GB
          </div>
          <div className="fnaProgressTrack">
            <div className="fnaProgressBar" style={{ width: `${memPct}%` }} />
          </div>
        </div>
        <div className="fnaMetricCard">
          <div className="label">磁盘</div>
          <div className="value">
            {metrics.diskUsed}/{metrics.diskTotal} GB
          </div>
          <div className="fnaProgressTrack">
            <div className="fnaProgressBar" style={{ width: `${diskPct}%` }} />
          </div>
        </div>
        <div className="fnaMetricCard">
          <div className="label">Goroutines</div>
          <div className="value">{metrics.goroutines}</div>
        </div>
      </div>

      <AdminCard>
        <div className="adminForm fnaDialogForm">
          <div className="fnaField fnaFieldInline">
            <span className="fnaFieldLabel">操作系统</span>
            <span className="fnaFieldControl">{metrics.os}</span>
          </div>
          <div className="fnaField fnaFieldInline">
            <span className="fnaFieldLabel">架构</span>
            <span className="fnaFieldControl">{metrics.arch}</span>
          </div>
          <div className="fnaField fnaFieldInline">
            <span className="fnaFieldLabel">运行时</span>
            <span className="fnaFieldControl">{metrics.goVersion}</span>
          </div>
          <div className="fnaField fnaFieldInline">
            <span className="fnaFieldLabel">运行时长</span>
            <span className="fnaFieldControl">{metrics.uptime}</span>
          </div>
        </div>
        <p style={{ margin: '12px 0 0', color: 'var(--el-text-color-secondary)' }}>
          演示数据每 3 秒刷新一次，不代表真实主机指标。
        </p>
      </AdminCard>
    </AdminPage>
  );
}
