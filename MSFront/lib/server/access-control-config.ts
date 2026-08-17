import accessControlConfig from '@/data/access-control.json';

export interface AccessRoleSeedDefinition {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  locked: boolean;
}

export interface AccessPermissionCatalogEntry {
  id: string;
  title: string;
  description: string;
}

export const MSFRONT_SUPPORTED_PERMISSIONS: readonly string[] =
  accessControlConfig.supportedPermissions;

export const MSFRONT_PERMISSION_CATALOG: readonly AccessPermissionCatalogEntry[] =
  accessControlConfig.permissionCatalog;

export const MSFRONT_DEFAULT_ROLE_DEFINITIONS: readonly AccessRoleSeedDefinition[] =
  accessControlConfig.defaultRoles;

export function normalizePermissionList(input: readonly string[]) {
  return Array.from(
    new Set(
      input.map((item) => `${item}`.trim()).filter((item) => item.length > 0 && item.length <= 96),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

export function isValidRoleIdentifier(value: string) {
  return /^[a-z][a-z0-9:_-]{1,63}$/i.test(value);
}

export function isValidPermissionIdentifier(value: string) {
  return /^[a-z][a-z0-9:._-]{1,95}$/i.test(value);
}

export function filterValidPermissionIdentifiers(input: readonly string[]) {
  return Array.from(
    new Set(
      input.map((item) => `${item}`.trim()).filter((item) => isValidPermissionIdentifier(item)),
    ),
  ).sort((left, right) => left.localeCompare(right));
}
