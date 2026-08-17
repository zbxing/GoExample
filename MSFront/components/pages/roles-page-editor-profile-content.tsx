'use client';

import { ShieldCheck } from 'lucide-react';
import { EditorSection } from '@/components/common/editor-section';
import type { RolesEditorProfileFieldModel } from '@/lib/utils/use-roles-page-editor-profile-presentation-controller';

export interface RolesProfileSectionModel {
  title: string;
  fields: readonly RolesEditorProfileFieldModel[];
}

interface RolesEditorProfileContentProps {
  profileSection: RolesProfileSectionModel;
}

export function RolesEditorProfileContent({
  profileSection,
}: RolesEditorProfileContentProps) {
  return (
    <EditorSection icon={<ShieldCheck size={16} />} title={profileSection.title}>
      <div className="formGrid">
        {profileSection.fields.map((field) => renderRolesProfileField(field))}
      </div>
    </EditorSection>
  );
}

function renderRolesProfileField(field: RolesEditorProfileFieldModel) {
  if (field.control === 'textarea') {
    return (
      <label key={field.id} className={field.className ? `field ${field.className}` : 'field'}>
        <span>{field.label}</span>
        <textarea
          value={field.value}
          rows={field.rows}
          disabled={field.disabled}
          onChange={
            field.onChange ? (event) => field.onChange?.(event.target.value) : undefined
          }
        />
      </label>
    );
  }

  return (
    <label key={field.id} className={field.className ? `field ${field.className}` : 'field'}>
      <span>{field.label}</span>
      <input
        value={field.value}
        disabled={field.disabled}
        onChange={
          field.onChange ? (event) => field.onChange?.(event.target.value) : undefined
        }
      />
    </label>
  );
}
