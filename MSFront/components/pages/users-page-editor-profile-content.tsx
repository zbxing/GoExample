'use client';

import { Users } from 'lucide-react';
import { EditorSection } from '@/components/common/editor-section';
import type { UsersEditorProfileFieldModel } from '@/lib/utils/use-users-page-editor-profile-presentation-controller';

export interface ProfileSectionModel {
  title: string;
  fields: readonly UsersEditorProfileFieldModel[];
}

interface UsersEditorProfileContentProps {
  profileSection: ProfileSectionModel;
}

export function UsersEditorProfileContent({
  profileSection,
}: UsersEditorProfileContentProps) {
  return (
    <EditorSection icon={<Users size={16} />} title={profileSection.title}>
      <div className="formGrid">
        {profileSection.fields.map((field) => renderUsersProfileField(field))}
      </div>
    </EditorSection>
  );
}

function renderUsersProfileField(field: UsersEditorProfileFieldModel) {
  if (field.control === 'summary') {
    return (
      <div key={field.id} className={field.className ? `field ${field.className}` : 'field'}>
        <span>{field.label}</span>
        <div className="inlineSummary">
          <strong>{field.value}</strong>
          <small>{field.detail}</small>
        </div>
      </div>
    );
  }

  if (field.control === 'select') {
    return (
      <label key={field.id} className={field.className ? `field ${field.className}` : 'field'}>
        <span>{field.label}</span>
        <select value={field.value} onChange={(event) => field.onChange(event.target.value)}>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label key={field.id} className={field.className ? `field ${field.className}` : 'field'}>
      <span>{field.label}</span>
      <input
        value={field.value}
        disabled={field.disabled}
        readOnly={field.readOnly}
        onChange={
          field.onChange ? (event) => field.onChange?.(event.target.value) : undefined
        }
      />
    </label>
  );
}
