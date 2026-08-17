'use client';

import type { AccessManagedUserEntry } from '@/lib/types/management';

export interface RegistryEntryModel {
  id: string;
  user: AccessManagedUserEntry;
  displayName: string;
  usernameLabel: string;
  roleSummary: string;
  selectionAriaLabel: string;
  tags: readonly string[];
}

interface UsersRegistryWorkspaceContentProps {
  focusUser: (user: AccessManagedUserEntry) => void;
  registryEntries: readonly RegistryEntryModel[];
  selectedUserId: string;
  selectedUserIds: readonly string[];
  toggleUserSelection: (userId: string) => void;
}

export function UsersRegistryWorkspaceContent({
  focusUser,
  registryEntries,
  selectedUserId,
  selectedUserIds,
  toggleUserSelection,
}: UsersRegistryWorkspaceContentProps) {
  if (registryEntries.length === 0) {
    return null;
  }

  return (
    <div className="registryList">
      {registryEntries.map((entry) => (
        <article
          key={entry.id}
          className={entry.id === selectedUserId ? 'registryItem active' : 'registryItem'}
        >
          <div className="registryItemHeader">
            <label className="selectionToggle">
              <input
                type="checkbox"
                checked={selectedUserIds.includes(entry.id)}
                onChange={() => toggleUserSelection(entry.id)}
                aria-label={entry.selectionAriaLabel}
              />
            </label>
            <button
              type="button"
              className="registryItemButton"
              onClick={() => focusUser(entry.user)}
            >
              <strong>{entry.displayName}</strong>
              <span>{entry.usernameLabel}</span>
              <small>{entry.roleSummary}</small>
              <div className="tagList">
                {entry.tags.map((tag) => (
                  <span key={`${entry.id}:${tag}`} className="securityTag">
                    {tag}
                  </span>
                ))}
              </div>
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
