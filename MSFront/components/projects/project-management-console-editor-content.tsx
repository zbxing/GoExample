'use client';

import { Server, TriangleAlert, Wrench } from 'lucide-react';
import { EditorSection } from '@/components/common/editor-section';
import { SummaryCard } from '@/components/common/management-primitives';
import {
  ProjectEntityEditorCard,
  ProjectEntityEditorSection,
} from '@/components/projects/project-entity-editor-surface';
import type { ProjectEditorFieldModel } from '@/lib/utils/use-project-management-console-presentation-controller';
import type { useProjectManagementConsolePresentationController } from '@/lib/utils/use-project-management-console-presentation-controller';
import type { useProjectManagementConsoleSurfaceController } from '@/lib/utils/use-project-management-console-surface-controller';

type TranslationFn = (path: string, variables?: Record<string, string | number>) => string;

interface ProjectManagementConsoleEditorContentProps {
  draft: object | null;
  editorSections: ReturnType<
    typeof useProjectManagementConsolePresentationController
  >['editorSections'];
  editorSummaryCards: ReturnType<
    typeof useProjectManagementConsoleSurfaceController
  >['editorSummaryCards'];
  editorValidationVisible: boolean;
  serverEditorSection: ReturnType<
    typeof useProjectManagementConsolePresentationController
  >['serverEditorSection'];
  serviceEditorSection: ReturnType<
    typeof useProjectManagementConsolePresentationController
  >['serviceEditorSection'];
  t: TranslationFn;
  validationIssues: readonly string[];
}

export function ProjectManagementConsoleEditorContent({
  draft,
  editorSections,
  editorSummaryCards,
  editorValidationVisible,
  serverEditorSection,
  serviceEditorSection,
  t,
  validationIssues,
}: ProjectManagementConsoleEditorContentProps) {
  if (!draft) {
    return null;
  }

  return (
    <>
      <div className="portfolioSummaryGrid">
        {editorSummaryCards.map((card) => (
          <SummaryCard
            key={card.label}
            label={card.label}
            value={card.value}
            footnote={card.footnote}
          />
        ))}
      </div>

      {editorValidationVisible ? (
        <EditorSection
          icon={<TriangleAlert size={16} />}
          title={t('projectConsole.issuesTitle')}
          description={t('projectConsole.issuesDescription')}
        >
          <ul className="validationList">
            {validationIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </EditorSection>
      ) : null}

      {editorSections.map((section) => (
        <EditorSection key={section.id} title={section.title} description={section.description}>
          <div className="formGrid">
            {section.fields.map((field) => renderProjectEditorField(field))}
          </div>
        </EditorSection>
      ))}

      {serverEditorSection ? (
        <ProjectEntityEditorSection
          icon={<Server size={16} />}
          title={serverEditorSection.title}
          description={serverEditorSection.description}
          addLabel={serverEditorSection.addLabel}
          onAdd={serverEditorSection.onAdd}
        >
          {serverEditorSection.cards.map((card) => (
            <ProjectEntityEditorCard
              key={card.id}
              title={card.title}
              removeLabel={card.removeLabel}
              onRemove={card.onRemove}
            >
              {card.fields.map((field) => renderProjectEditorField(field))}
            </ProjectEntityEditorCard>
          ))}
        </ProjectEntityEditorSection>
      ) : null}

      {serviceEditorSection ? (
        <ProjectEntityEditorSection
          icon={<Wrench size={16} />}
          title={serviceEditorSection.title}
          description={serviceEditorSection.description}
          addLabel={serviceEditorSection.addLabel}
          onAdd={serviceEditorSection.onAdd}
        >
          {serviceEditorSection.cards.map((card) => (
            <ProjectEntityEditorCard
              key={card.id}
              title={card.title}
              removeLabel={card.removeLabel}
              onRemove={card.onRemove}
            >
              {card.fields.map((field) => renderProjectEditorField(field))}
            </ProjectEntityEditorCard>
          ))}
        </ProjectEntityEditorSection>
      ) : null}
    </>
  );
}

function renderProjectEditorField(field: ProjectEditorFieldModel) {
  return (
    <label key={field.id} className={field.className ? `field ${field.className}` : 'field'}>
      <span>{field.label}</span>
      {renderProjectEditorFieldControl(field)}
      {field.hint ? <small className="fieldHint">{field.hint}</small> : null}
    </label>
  );
}

function renderProjectEditorFieldControl(field: ProjectEditorFieldModel) {
  if (field.control === 'textarea') {
    return (
      <textarea
        value={field.value}
        onChange={(event) => field.onChange(event.target.value)}
        rows={field.rows}
        placeholder={field.placeholder}
      />
    );
  }

  if (field.control === 'select') {
    return (
      <select value={field.value} onChange={(event) => field.onChange(event.target.value)}>
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (field.control === 'number') {
    return (
      <input
        type="number"
        value={field.value}
        step={field.step}
        onChange={(event) => field.onChange(Number(event.target.value))}
      />
    );
  }

  return (
    <input
      type={field.inputType ?? 'text'}
      step={field.step}
      value={field.value}
      onChange={(event) => field.onChange(event.target.value)}
      placeholder={field.placeholder}
    />
  );
}
