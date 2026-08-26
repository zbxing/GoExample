import type {
  AuthSessionUser,
  CasbinPolicyRecord,
  CopySystemRoleInput,
  CreateSystemApiInput,
  CreateSystemMenuInput,
  CreateSystemRoleInput,
  CreateSystemUserInput,
  ReplaceCasbinPoliciesInput,
  SetRoleUsersInput,
  SystemApiRecord,
  SystemMenuRecord,
  SystemMenuTreeNode,
  SystemRoleRecord,
  SystemUserPublic,
  UpdateSystemApiInput,
  UpdateSystemMenuInput,
  UpdateSystemRoleInput,
  UpdateSystemUserInput,
} from '@/lib/types/system';

export interface SystemAdapter {
  login(username: string, password: string): Promise<AuthSessionUser | null>;
  getMe(userId: string): Promise<AuthSessionUser | null>;
  listUsers(search?: string): Promise<SystemUserPublic[]>;
  createUser(input: CreateSystemUserInput): Promise<SystemUserPublic>;
  updateUser(input: UpdateSystemUserInput): Promise<SystemUserPublic>;
  deleteUser(userId: string): Promise<{ id: string }>;
  setRoleUsers(input: SetRoleUsersInput): Promise<{ roleId: string; userIds: string[] }>;
  listRoles(): Promise<SystemRoleRecord[]>;
  createRole(input: CreateSystemRoleInput): Promise<SystemRoleRecord>;
  updateRole(input: UpdateSystemRoleInput): Promise<SystemRoleRecord>;
  deleteRole(roleId: string): Promise<{ id: string }>;
  copyRole(input: CopySystemRoleInput): Promise<SystemRoleRecord>;
  listMenus(): Promise<SystemMenuRecord[]>;
  listMenuTree(): Promise<SystemMenuTreeNode[]>;
  listAsyncMenus(menuIds: string[]): Promise<SystemMenuTreeNode[]>;
  createMenu(input: CreateSystemMenuInput): Promise<SystemMenuRecord>;
  updateMenu(input: UpdateSystemMenuInput): Promise<SystemMenuRecord>;
  deleteMenu(menuId: string): Promise<{ id: string }>;
  listApis(search?: string): Promise<SystemApiRecord[]>;
  createApi(input: CreateSystemApiInput): Promise<SystemApiRecord>;
  updateApi(input: UpdateSystemApiInput): Promise<SystemApiRecord>;
  deleteApi(apiId: string): Promise<{ id: string }>;
  listCasbin(roleId?: string): Promise<CasbinPolicyRecord[]>;
  replaceCasbin(input: ReplaceCasbinPoliciesInput): Promise<CasbinPolicyRecord[]>;
}

export function resolveSystemBackendMode() {
  const value = `${process.env.MSFRONT_SYSTEM_BACKEND ?? 'local'}`.trim().toLowerCase();
  return value === 'fiber' ? 'fiber' : 'local';
}
