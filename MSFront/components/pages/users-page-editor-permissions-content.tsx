'use client';

import { ShieldPlus } from 'lucide-react';
import { EditorSection } from '@/components/common/editor-section';
import {
  AccessCustomInputField,
  AccessSelectionGrid,
  AccessSelectionOptionCard,
} from '@/components/common/access-selection-surface';

interface PermissionTagModel {
  id: string;
  label: string;
}

interface PermissionOptionModel {
  id: string;
  checked: boolean;
  disabled: boolean;
  title: string;
  description: string;
}

interface CustomPermissionFieldModel {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}

interface PermissionPanelModel {
  id: string;
  title: string;
  description: string;
  tags?: readonly PermissionTagModel[];
  options?: readonly PermissionOptionModel[];
  customField?: CustomPermissionFieldModel;
}

export interface PermissionSectionModel {
  title: string;
  panels: readonly PermissionPanelModel[];
}

interface UsersEditorPermissionsContentProps {
  permissionSection: PermissionSectionModel;
  toggleExtraPermission: (permission: string) => void;
}

export function UsersEditorPermissionsContent({
  permissionSection,
  toggleExtraPermission,
}: UsersEditorPermissionsContentProps) {
  return (
    <EditorSection icon={<ShieldPlus size={16} />} title={permissionSection.title}>
      <div className="accessPermissionStack">
        {permissionSection.panels.map((panel) => (
          <article key={panel.id} className="accessPermissionPanel">
            <span className="serviceCategory">{panel.title}</span>
            <p>{panel.description}</p>
            {panel.tags ? (
              <div className="tagList">
                {panel.tags.map((permission) => (
                  <span key={permission.id} className="securityTag">
                    {permission.label}
                  </span>
                ))}
              </div>
            ) : null}
            {panel.options ? (
              <AccessSelectionGrid>
                {panel.options.map((permission) => (
                  <AccessSelectionOptionCard
                    key={permission.id}
                    checked={permission.checked}
                    disabled={permission.disabled}
                    onChange={() => toggleExtraPermission(permission.id)}
                    content={
                      <>
                        <strong>{permission.title}</strong>
                        <span>{permission.description}</span>
                      </>
                    }
                  />
                ))}
              </AccessSelectionGrid>
            ) : null}
            {panel.customField ? (
              <AccessCustomInputField
                label={panel.customField.label}
                value={panel.customField.value}
                onChange={panel.customField.onChange}
                placeholder={panel.customField.placeholder}
              />
            ) : null}
          </article>
        ))}
      </div>
    </EditorSection>
  );
}
