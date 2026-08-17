'use client';

import {
  SummaryCard,
  TonePill,
} from '@/components/common/management-primitives';
import { useLocale } from '@/providers/locale-provider';
import type { useSettingsPanelSurfaceController } from '@/lib/utils/use-settings-panel-surface-controller';

interface SettingsHeroContentProps {
  heroFootnote: ReturnType<typeof useSettingsPanelSurfaceController>['heroFootnote'];
  heroPills: ReturnType<typeof useSettingsPanelSurfaceController>['heroPills'];
  heroSummaryCards: ReturnType<typeof useSettingsPanelSurfaceController>['heroSummaryCards'];
}

export function SettingsHeroContent({
  heroFootnote,
  heroPills,
  heroSummaryCards,
}: SettingsHeroContentProps) {
  const { t } = useLocale();

  return (
    <div className="settingsHeroGrid">
      <article className="heroCard settingsHeroCard">
        <div className="heroInfo settingsHeroCopy">
          <div>
            <span className="sectionEyebrow">{t('settingsPanel.heroEyebrow')}</span>
            <h2>{t('settingsPanel.heroTitle')}</h2>
            <p>{t('settingsPanel.heroDescription')}</p>
          </div>

          <div className="tagList">
            {heroPills.map((pill) => (
              <TonePill key={pill.id} label={pill.label} tone={pill.tone} showStatusIcon />
            ))}
          </div>

          <p className="summaryFootnote">{heroFootnote}</p>
        </div>

        <div className="heroStats settingsHeroStatsGrid">
          {heroSummaryCards.map((card) => (
            <SummaryCard
              key={card.id}
              label={card.label}
              value={card.value}
              footnote={card.footnote}
            />
          ))}
        </div>
      </article>
    </div>
  );
}
