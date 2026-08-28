export type SystemUserStatus = 'active' | 'disabled';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface SystemMenuParameter {
  type: 'query' | 'params';
  key: string;
  value: string;
}

export interface SystemMenuRecord {
  id: string;
  parentId: string;
  path: string;
  name: string;
  component: string;
  title: string;
  icon: string;
  hidden: boolean;
  sort: number;
  keepAlive: boolean;
  menuBtns: string[];
  /** 路由参数配置（对齐 GVA form.parameters） */
  parameters?: SystemMenuParameter[];
}

export interface SystemMenuTreeNode extends SystemMenuRecord {
  children: SystemMenuTreeNode[];
}

export interface SystemRoleRecord {
  id: string;
  name: string;
  description: string;
  parentId: string;
  defaultRouter: string;
  /** 数据权限：1全部 2本部门及以下 3本部门 4仅本人 5自定义部门 */
  dataScope: 1 | 2 | 3 | 4 | 5;
  menuIds: string[];
  btnAuths: string[];
  locked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SystemUserRecord {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string;
  email: string;
  phone: string;
  status: SystemUserStatus;
  roleIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SystemUserPublic {
  id: string;
  username: string;
  displayName: string;
  email: string;
  phone: string;
  status: SystemUserStatus;
  roleIds: string[];
  roleNames: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SystemApiRecord {
  id: string;
  path: string;
  method: HttpMethod;
  apiGroup: string;
  description: string;
}

export interface CasbinPolicyRecord {
  id: string;
  roleId: string;
  path: string;
  method: HttpMethod;
}

export interface AuthSessionUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  phone: string;
  status: SystemUserStatus;
  roleIds: string[];
  roleNames: string[];
  btnAuths: string[];
  menuIds: string[];
  defaultRouter: string;
}

export interface AuthTokenPayload {
  sub: string;
  username: string;
  roleIds: string[];
}

export interface LoginRequestBody {
  username: string;
  password: string;
}

export interface CreateSystemUserInput {
  username: string;
  password: string;
  displayName: string;
  email?: string;
  phone?: string;
  status?: SystemUserStatus;
  roleIds: string[];
}

export interface UpdateSystemUserInput {
  id: string;
  displayName?: string;
  email?: string;
  phone?: string;
  status?: SystemUserStatus;
  roleIds?: string[];
  password?: string;
}

export interface CreateSystemRoleInput {
  id?: string;
  name: string;
  description?: string;
  parentId?: string;
  defaultRouter?: string;
  dataScope?: 1 | 2 | 3 | 4 | 5;
  menuIds?: string[];
  btnAuths?: string[];
}

export interface UpdateSystemRoleInput {
  id: string;
  name?: string;
  description?: string;
  parentId?: string;
  defaultRouter?: string;
  dataScope?: 1 | 2 | 3 | 4 | 5;
  menuIds?: string[];
  btnAuths?: string[];
}

export interface CopySystemRoleInput {
  id: string;
  name: string;
  parentId?: string;
  oldAuthorityId: string;
  dataScope?: 1 | 2 | 3 | 4 | 5;
}

export interface SetRoleUsersInput {
  roleId: string;
  userIds: string[];
}

export interface CreateSystemMenuInput {
  parentId?: string;
  path: string;
  name: string;
  component: string;
  title: string;
  icon?: string;
  hidden?: boolean;
  sort?: number;
  keepAlive?: boolean;
  menuBtns?: string[];
  parameters?: SystemMenuParameter[];
}

export interface UpdateSystemMenuInput extends Partial<CreateSystemMenuInput> {
  id: string;
}

export interface CreateSystemApiInput {
  path: string;
  method: HttpMethod;
  apiGroup: string;
  description?: string;
}

export interface UpdateSystemApiInput extends Partial<CreateSystemApiInput> {
  id: string;
}

export interface ReplaceCasbinPoliciesInput {
  roleId: string;
  policies: Array<{ path: string; method: HttpMethod }>;
}
