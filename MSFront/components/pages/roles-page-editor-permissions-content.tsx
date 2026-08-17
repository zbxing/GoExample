'use client';

import { ShieldCheck } from 'lucide-react';
import { EditorSection } from '@/components/common/editor-section';
import {
  AccessCustomInputField,
  AccessSelectionGrid,
  AccessSelectionOptionCard,
} from '@/components/common/access-selection-surface';

interface RolesPermissionSelectionOptionModel {
  id: string;
  checked: boolean;
  disabled: boolean;
  title: string;
  description: string;
}

export interface RolesEditorPermissionsSectionModel {
  title: string;
  description: string;
  options: readonly RolesPermissionSelectionOptionModel[];
  customPermissionField: {
    label: string;
    value: string;
    placeholder: string;
    disabled: boolean;
    onChange: (value: string) => void;
  };
}

interface RolesEditorPermissionsContentProps {
  permissionSection: RolesEditorPermissionsSectionModel;
  togglePermission: (permission: string) => void;
}

export function RolesEditorPermissionsContent({
  permissionSection,
  togglePermission,
}: RolesEditorPermissionsContentProps) {
  return (
    <EditorSection
      icon={<ShieldCheck size={16} />}
      title={permissionSection.title}
      description={permissionSection.description}
      descriptionClassName="summaryFootnote"
    >
      <AccessSelectionGrid>
        {permissionSection.options.map((permission) => (
          <AccessSelectionOptionCard
            key={permission.id}
            checked={permission.checked}
            disabled={permission.disabled}
            onChange={() => togglePermission(permission.id)}
            content={
              <>
                <strong>{permission.title}</strong>
                <span>{permission.description}</span>
              </>
            }
          />
        ))}
      </AccessSelectionGrid>
      <AccessCustomInputField
        label={permissionSection.customPermissionField.label}
        value={permissionSection.customPermissionField.value}
        disabled={permissionSection.customPermissionField.disabled}
        onChange={permissionSection.customPermissionField.onChange}
        placeholder={permissionSection.customPermissionField.placeholder}
      />
    </EditorSection>
  );
}
