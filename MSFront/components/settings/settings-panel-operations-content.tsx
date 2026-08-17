'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Boxes,
  Cable,
  Database,
  MonitorCog,
  Rocket,
  ShieldCheck,
} from 'lucide-react';
import {
  SummaryCard,
  TonePill,
} from '@/components/common/management-primitives';
import { useLocale } from '@/providers/locale-provider';
import type { useSettingsPanelOperationsSurfaceController } from '@/lib/utils/use-settings-panel-operations-surface-controller';
import type { useSettingsPanelRuntimeSurfaceController } from '@/lib/utils/use-settings-panel-runtime-surface-controller';

interface SettingsRuntimeContentProps {
  runtimeFacts: ReturnType<typeof useSettingsPanelRuntimeSurfaceController>['runtimeFacts'];
  workspaceFacts: ReturnType<typeof useSettingsPanelRuntimeSurfaceController>['workspaceFacts'];
  workspaceStatus: ReturnType<typeof useSettingsPanelRuntimeSurfaceController>['workspaceStatus'];
}

interface SettingsCapabilitiesContentProps {
  capabilityCards: ReturnType<typeof useSettingsPanelOperationsSurfaceController>['capabilityCards'];
}

interface SettingsSourcesContentProps {
  sourceCards: ReturnType<typeof useSettingsPanelRuntimeSurfaceController>['sourceCards'];
}

interface SettingsGovernanceContentProps {
  governanceTags: ReturnType<typeof useSettingsPanelOperationsSurfaceController>['governanceTags'];
  settingsActionLinks: ReturnType<typeof useSettingsPanelOperationsSurfaceController>['settingsActionLinks'];
}

export function SettingsRuntimeContent({
  runtimeFacts,
  workspaceFacts,
  workspaceStatus,
}: SettingsRuntimeContentProps) {
  const { t } = useLocale();

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <h2>{t('settingsPanel.runtimeTitle')}</h2>
          <p>{t('settingsPanel.runtimeDescription')}</p>
        </div>
      </div>

      <div className="settingsWiringGrid">
        <article className="settingsCard settingsCardPanel">
          <div className="settingsCardHeader">
            <span>
              <MonitorCog size={16} />
              {t('settingsPanel.runtimeSurfaceTitle')}
            </span>
            <p>{t('settingsPanel.runtimeSurfaceDescription')}</p>
          </div>

          <div className="settingsFacts">
            {runtimeFacts.map((field) => (
              <div key={field.id} className="endpointField">
                <span>{field.label}</span>
                <strong>{field.value}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="settingsCard settingsCardPanel">
          <div className="settingsCardHeader">
            <span>
              <Database size={16} />
              {t('settingsPanel.workspaceDataTitle')}
            </span>
            <p>{t('settingsPanel.workspaceDataDescription')}</p>
          </div>

          <div className="inlineSummary">
            <div>
              <strong>{t('settingsPanel.projectSourceLabel')}</strong>
              <small>{workspaceStatus.footnote}</small>
            </div>
            <TonePill
              label={workspaceStatus.label}
              tone={workspaceStatus.tone}
              showStatusIcon
            />
          </div>

          <div className="settingsFacts">
            {workspaceFacts.map((field) => (
              <div key={field.id} className="endpointField">
                <span>{field.label}</span>
                <strong>{field.value}</strong>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

export function SettingsCapabilitiesContent({
  capabilityCards,
}: SettingsCapabilitiesContentProps) {
  const { t } = useLocale();

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <h2>{t('settingsPanel.capabilitiesTitle')}</h2>
          <p>{t('settingsPanel.capabilitiesDescription')}</p>
        </div>
      </div>

      <div className="settingsCapabilityGrid">
        {capabilityCards.map((card) => (
          <SummaryCard
            key={card.id}
            label={card.label}
            value={card.value}
            footnote={card.footnote}
          />
        ))}
      </div>
    </section>
  );
}

export function SettingsSourcesContent({ sourceCards }: SettingsSourcesContentProps) {
  const { t } = useLocale();

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <h2>{t('settingsPanel.dataSourcesTitle')}</h2>
          <p>{t('settingsPanel.dataSourcesDescription')}</p>
        </div>
      </div>

      <div className="settingsSourceGrid">
        {sourceCards.map((card) => (
          <article key={card.id} className="securitySurfaceCard settingsSourceCard">
            <div className="securityHeaderRow">
              <div>
                <span className="serviceCategory">{card.eyebrow}</span>
                <h3>{card.title}</h3>
                <p>{card.description}</p>
              </div>
              <TonePill label={card.badgeLabel} tone={card.tone} showStatusIcon />
            </div>
            <p className="summaryFootnote">{card.footnote}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function SettingsGovernanceContent({
  governanceTags,
  settingsActionLinks,
}: SettingsGovernanceContentProps) {
  const { t } = useLocale();

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <h2>{t('settingsPanel.governanceTitle')}</h2>
          <p>{t('settingsPanel.governanceDescription')}</p>
        </div>
      </div>

      <div className="tagList">
        {governanceTags.map((tag) => (
          <span key={tag} className="securityTag">
            {tag}
          </span>
        ))}
      </div>

      <div className="settingsActionGrid">
        {settingsActionLinks.map((item) => {
          const Icon =
            item.icon === 'projects'
              ? Boxes
              : item.icon === 'integrations'
                ? Cable
                : item.icon === 'security'
                  ? ShieldCheck
                  : Rocket;

          return (
            <Link key={item.href} href={item.href} className="secondaryButton">
              <Icon size={14} />
              {item.label}
              <ArrowRight size={14} />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
