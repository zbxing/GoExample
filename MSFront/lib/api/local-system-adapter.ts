import type { SystemAdapter } from '@/lib/api/system-adapter';
import {
  createSystemApi,
  deleteSystemApi,
  listSystemApis,
  updateSystemApi,
} from '@/lib/server/system-api-repository';
import {
  copyCasbinPoliciesForRole,
  listCasbinPolicies,
  replaceCasbinPoliciesForRole,
} from '@/lib/server/system-casbin-repository';
import {
  createSystemMenu,
  deleteSystemMenu,
  listAsyncMenusForRoles,
  listSystemMenuTree,
  listSystemMenus,
  updateSystemMenu,
} from '@/lib/server/system-menu-repository';
import {
  copySystemRole,
  createSystemRole,
  deleteSystemRole,
  listSystemRoles,
  updateSystemRole,
} from '@/lib/server/system-role-repository';
import {
  authenticateSystemUser,
  buildAuthSessionUser,
  createSystemUser,
  deleteSystemUser,
  getSystemUserById,
  listSystemUsers,
  setUsersForRole,
  updateSystemUser,
} from '@/lib/server/system-user-repository';

export const localSystemAdapter: SystemAdapter = {
  async login(username, password) {
    const user = await authenticateSystemUser(username, password);
    if (!user) {
      return null;
    }
    return buildAuthSessionUser(user);
  },
  async getMe(userId) {
    const user = await getSystemUserById(userId);
    if (!user || user.status !== 'active') {
      return null;
    }
    return buildAuthSessionUser(user);
  },
  listUsers: listSystemUsers,
  createUser: createSystemUser,
  updateUser: updateSystemUser,
  deleteUser: deleteSystemUser,
  setRoleUsers: async (input) => setUsersForRole(input.roleId, input.userIds),
  listRoles: listSystemRoles,
  createRole: createSystemRole,
  updateRole: updateSystemRole,
  deleteRole: deleteSystemRole,
  copyRole: async (input) => {
    const role = await copySystemRole(input);
    await copyCasbinPoliciesForRole(input.oldAuthorityId, role.id);
    return role;
  },
  listMenus: listSystemMenus,
  listMenuTree: listSystemMenuTree,
  listAsyncMenus: listAsyncMenusForRoles,
  createMenu: createSystemMenu,
  updateMenu: updateSystemMenu,
  deleteMenu: deleteSystemMenu,
  listApis: listSystemApis,
  createApi: createSystemApi,
  updateApi: updateSystemApi,
  deleteApi: deleteSystemApi,
  listCasbin: listCasbinPolicies,
  replaceCasbin: replaceCasbinPoliciesForRole,
};
