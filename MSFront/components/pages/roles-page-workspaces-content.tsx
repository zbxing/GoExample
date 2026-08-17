'use client';

import type { AccessManagedRoleEntry } from '@/lib/types/management';

export interface RolesRegistryEntryModel {
  id: string;
  role: AccessManagedRoleEntry;
  title: string;
  identity: string;
  description: string;
  tags: readonly string[];
}

interface RolesRegistryWorkspaceContentProps {
  handleSelectRole: (role: AccessManagedRoleEntry) => void;
  isCreating: boolean;
  registryEntries: readonly RolesRegistryEntryModel[];
  selectedRoleId: string;
}

export function RolesRegistryWorkspaceContent({
  handleSelectRole,
  isCreating,
  registryEntries,
  selectedRoleId,
}: RolesRegistryWorkspaceContentProps) {
  if (registryEntries.length === 0) {
    return null;
  }

  return (
    <div className="registryList">
      {registryEntries.map((role) => (
        <button
          key={role.id}
          type="button"
          className={
            role.id === selectedRoleId && !isCreating ? 'registryItem active' : 'registryItem'
          }
          onClick={() => handleSelectRole(role.role)}
        >
          <strong>{role.title}</strong>
          <span>{role.identity}</span>
          <small>{role.description}</small>
          <div className="tagList">
            {role.tags.map((tag) => (
              <span key={`${role.id}:${tag}`} className="securityTag">
                {tag}
              </span>
            ))}
          </div>
        </button>
      ))}
    </div>
  );
}
