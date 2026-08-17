'use client';

import { useMemo } from 'react';
import { buildProjectRuntimeSummary } from '@/lib/management/runtime';
import type {
  LocaleCode,
  ManagedProject,
  ManagedProjectRuntimeProbe,
} from '@/lib/types/management';
import {
  formatDateTime,
  formatNumber,
  formatPercent,
  joinDetails,
} from '@/lib/utils/format';
import { copyTextToClipboard } from '@/lib/utils/clipboard';
import { useFeedback } from '@/lib/utils/use-feedback';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;
type SignalTone = 'success' | 'warning' | 'danger' | 'info';

interface UseProjectDetailPageControllerOptions {
  project: ManagedProject;
  health: ManagedProjectRuntimeProbe | null;
  generatedAt: string;
  locale: LocaleCode;
  t: TranslationFn;
}

export function useProjectDetailPageController({
  project,
  health,
  generatedAt,
  locale,
  t,
}: UseProjectDetailPageControllerOptions) {
  const { feedback, clearFeedback, showError, showSuccess } = useFeedback();
  const projectConsoleKey = useMemo(
    () =>
      JSON.stringify(
        [project.id, project.code, project.name, project.status, project.environment, project.version, project.lastDeployedAt],
      ),
    [project],
  );
  const runtimeSummary = useMemo(
    () =>
      buildProjectRuntimeSummary(health, locale, t, {
        consoleUrl: project.baseUrl,
        apiUrl: project.apiBaseUrl,
        probeUrl: project.probeBaseUrl ?? null,
      }),
    [health, locale, project.apiBaseUrl, project.baseUrl, project.probeBaseUrl, t],
  );
  const releaseAgeInDays = useMemo(() => {
    const deployedAt = new Date(project.lastDeployedAt).valueOf();
    const today = new Date(generatedAt).setHours(0, 0, 0, 0);

    if (!Number.isFinite(deployedAt) || !Number.isFinite(today)) {
      return 0;
    }

    return Math.max(0, Math.floor((today - deployedAt) / 86_400_000));
  }, [generatedAt, project.lastDeployedAt]);
  const releaseAgeLabel =
    releaseAgeInDays === 0
      ? t('projectDetail.releaseToday')
      : t('projectDetail.releaseDays', {
          count: formatNumber(releaseAgeInDays, locale),
        });
  const serverAttention = useMemo(() => {
    const warningCount = project.servers.filter((server) => server.status === 'warning').length;
    const criticalCount = project.servers.filter((server) => server.status === 'critical').length;
    const attentionCount = warningCount + criticalCount;
    const topServer =
      [...project.servers].sort(
        (left, right) => serverPressureScore(right) - serverPressureScore(left),
      )[0] ?? null;

    return {
      warningCount,
      criticalCount,
      attentionCount,
      topServer,
      tone: toneFromStatusCounts(warningCount, criticalCount),
    };
  }, [project.servers]);
  const serviceAttention = useMemo(() => {
    const warningCount = project.services.filter((service) => service.status === 'warning').length;
    const criticalCount = project.services.filter((service) => service.status === 'critical').length;
    const attentionCount = warningCount + criticalCount;
    const categoryCounts = project.services.reduce<Map<string, number>>((map, service) => {
      if (service.status === 'healthy') {
        return map;
      }

      map.set(service.category, (map.get(service.category) ?? 0) + 1);
      return map;
    }, new Map());
    const topCategory =
      [...categoryCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;

    return {
      warningCount,
      criticalCount,
      attentionCount,
      topCategory,
      tone: toneFromStatusCounts(warningCount, criticalCount),
    };
  }, [project.services]);
  const probeSignal = useMemo(() => {
    if (!project.probeBaseUrl) {
      return {
        label: t('projectDetail.probeMissing'),
        tone: 'warning' as const,
      };
    }

    return {
      label: runtimeSummary.statusLabel,
      tone:
        runtimeSummary.tone === 'danger'
          ? ('danger' as const)
          : runtimeSummary.tone === 'warning'
            ? ('warning' as const)
            : runtimeSummary.tone === 'success'
              ? ('success' as const)
              : ('info' as const),
    };
  }, [project.probeBaseUrl, runtimeSummary.statusLabel, runtimeSummary.tone, t]);
  const overviewCards = useMemo(
    () => [
      {
        label: t('labels.activeUsers'),
        value: formatNumber(project.activeUsers, locale),
        footnote: project.owner,
      },
      {
        label: t('labels.requests'),
        value: formatNumber(project.requestPerMinute, locale),
        footnote: t(`status.${project.environment}`),
      },
      {
        label: t('labels.errorRate'),
        value: `${formatPercent(project.errorRate, locale)}%`,
        footnote: runtimeSummary.statusLabel,
      },
      {
        label: t('labels.lastDeploy'),
        value: formatDateTime(project.lastDeployedAt, locale),
        footnote: releaseAgeLabel,
      },
      {
        label: t('projectConsole.overview.servers'),
        value: formatNumber(project.servers.length, locale),
        footnote: joinDetails([
          `${formatNumber(serverAttention.warningCount, locale)} ${t('status.warning')}`,
          `${formatNumber(serverAttention.criticalCount, locale)} ${t('status.critical')}`,
        ]),
      },
      {
        label: t('projectConsole.overview.services'),
        value: formatNumber(project.services.length, locale),
        footnote: joinDetails([
          `${formatNumber(serviceAttention.warningCount, locale)} ${t('status.warning')}`,
          `${formatNumber(serviceAttention.criticalCount, locale)} ${t('status.critical')}`,
        ]),
      },
    ],
    [
      locale,
      project.activeUsers,
      project.environment,
      project.errorRate,
      project.lastDeployedAt,
      project.owner,
      project.requestPerMinute,
      project.servers.length,
      project.services.length,
      releaseAgeLabel,
      runtimeSummary.statusLabel,
      serverAttention.criticalCount,
      serverAttention.warningCount,
      serviceAttention.criticalCount,
      serviceAttention.warningCount,
      t,
    ],
  );
  const attentionCards = useMemo(() => {
    const trafficTone =
      project.errorRate >= 1 || project.status === 'critical'
        ? 'danger'
        : project.errorRate >= 0.5 || project.status === 'warning'
          ? 'warning'
          : 'success';
    const releaseTone = releaseAgeInDays >= 21 ? 'warning' : releaseAgeInDays >= 7 ? 'info' : 'success';
    const trafficDetailKey = trafficTone === 'success' ? 'trafficHealthy' : 'trafficAttention';
    const releaseDetailKey = releaseTone === 'warning' ? 'releaseStale' : 'releaseFresh';

    return [
      {
        label: t('projectDetail.signals.infrastructure'),
        value:
          project.servers.length === 0
            ? formatNumber(0, locale)
            : formatNumber(serverAttention.attentionCount, locale),
        detail:
          project.servers.length === 0
            ? t('projectDetail.signals.infrastructureEmpty')
            : serverAttention.attentionCount === 0
              ? t('projectDetail.signals.infrastructureHealthy', {
                  count: formatNumber(project.servers.length, locale),
                })
              : t('projectDetail.signals.infrastructureAttention', {
                  count: formatNumber(serverAttention.attentionCount, locale),
                  server: serverAttention.topServer?.name ?? t('security.emptyValue'),
                }),
        tone: serverAttention.tone,
      },
      {
        label: t('projectDetail.signals.services'),
        value:
          project.services.length === 0
            ? formatNumber(0, locale)
            : formatNumber(serviceAttention.attentionCount, locale),
        detail:
          project.services.length === 0
            ? t('projectDetail.signals.servicesEmpty')
            : serviceAttention.attentionCount === 0
              ? t('projectDetail.signals.servicesHealthy', {
                  count: formatNumber(project.services.length, locale),
                })
              : t('projectDetail.signals.servicesAttention', {
                  count: formatNumber(serviceAttention.attentionCount, locale),
                  category: serviceAttention.topCategory
                    ? t(`dashboard.services.categories.${serviceAttention.topCategory}`)
                    : t('security.emptyValue'),
                }),
        tone: serviceAttention.tone,
      },
      {
        label: t('projectDetail.signals.traffic'),
        value: `${formatPercent(project.errorRate, locale)}%`,
        detail: t(`projectDetail.signals.${trafficDetailKey}`, {
          requests: formatNumber(project.requestPerMinute, locale),
          users: formatNumber(project.activeUsers, locale),
        }),
        tone: trafficTone,
      },
      {
        label: t('projectDetail.signals.release'),
        value: releaseAgeLabel,
        detail: t(`projectDetail.signals.${releaseDetailKey}`, {
          timestamp: formatDateTime(project.lastDeployedAt, locale),
        }),
        tone: releaseTone,
      },
    ] satisfies Array<{
      label: string;
      value: string;
      detail: string;
      tone: SignalTone;
    }>;
  }, [
    locale,
    project.activeUsers,
    project.errorRate,
    project.lastDeployedAt,
    project.requestPerMinute,
    project.servers.length,
    project.services.length,
    project.status,
    releaseAgeInDays,
    releaseAgeLabel,
    serverAttention.attentionCount,
    serverAttention.tone,
    serverAttention.topServer?.name,
    serviceAttention.attentionCount,
    serviceAttention.tone,
    serviceAttention.topCategory,
    t,
  ]);

  async function handleCopyApi() {
    clearFeedback();

    try {
      await copyTextToClipboard(project.apiBaseUrl);
      showSuccess(t('projectDetail.messages.copySuccess'));
    } catch {
      showError(t('projectDetail.messages.copyError'));
    }
  }

  async function handleCopyCurrentView() {
    clearFeedback();

    try {
      await copyTextToClipboard(window.location.href);
      showSuccess(t('projectDetail.messages.copyFiltersSuccess'));
    } catch {
      showError(t('projectDetail.messages.copyFiltersError'));
    }
  }

  return {
    attentionCards,
    feedback,
    handleCopyApi,
    handleCopyCurrentView,
    overviewCards,
    probeSignal,
    projectConsoleKey,
    releaseAgeLabel,
    runtimeSummary,
    serverAttention,
    serviceAttention,
  };
}

function toneFromStatusCounts(warningCount: number, criticalCount: number): SignalTone {
  if (criticalCount > 0) {
    return 'danger';
  }

  if (warningCount > 0) {
    return 'warning';
  }

  return 'success';
}

function serverPressureScore(server: ManagedProject['servers'][number]) {
  const statusScore = server.status === 'critical' ? 80 : server.status === 'warning' ? 35 : 0;
  return statusScore + server.cpuUsage + server.memoryUsage + server.responseTimeMs / 10;
}
