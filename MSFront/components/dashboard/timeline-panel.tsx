'use client';

import { useLocale } from '@/providers/locale-provider';
import { formatDateTime } from '@/lib/utils/format';
import type { TimelineItem } from '@/lib/types/management';

interface TimelinePanelProps {
  title: string;
  items: TimelineItem[];
  emptyMessage: string;
}

export function TimelinePanel({ title, items, emptyMessage }: TimelinePanelProps) {
  const { locale } = useLocale();

  return (
    <section className="panel">
      <div className="panelHeader">
        <h2>{title}</h2>
      </div>
      {items.length === 0 ? (
        <p className="emptyState">{emptyMessage}</p>
      ) : (
        <div className="timeline">
          {items.map((item) => (
            <article key={item.id} className="timelineItem">
              <div className={`timelineDot tone-${item.tone}`} />
              <div>
                <strong>{item.title}</strong>
                <p>{item.description}</p>
                <div className="timelineMeta">
                  {item.meta ? (
                    <span className={`timelinePill tone-${item.tone}`}>{item.meta}</span>
                  ) : null}
                  <span>{formatDateTime(item.timestamp, locale)}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
