import type { SystemAdapter } from '@/lib/api/system-adapter';

function notImplemented(): never {
  throw new Error(
    'The Fiber system backend is not wired for RBAC management yet. Set MSFRONT_SYSTEM_BACKEND=local or implement FiberSystemAdapter.',
  );
}

export const fiberSystemAdapter: SystemAdapter = {
  login: async () => notImplemented(),
  getMe: async () => notImplemented(),
  listUsers: async () => notImplemented(),
  createUser: async () => notImplemented(),
  updateUser: async () => notImplemented(),
  deleteUser: async () => notImplemented(),
  listRoles: async () => notImplemented(),
  createRole: async () => notImplemented(),
  updateRole: async () => notImplemented(),
  deleteRole: async () => notImplemented(),
  listMenus: async () => notImplemented(),
  listMenuTree: async () => notImplemented(),
  listAsyncMenus: async () => notImplemented(),
  createMenu: async () => notImplemented(),
  updateMenu: async () => notImplemented(),
  deleteMenu: async () => notImplemented(),
  listApis: async () => notImplemented(),
  createApi: async () => notImplemented(),
  updateApi: async () => notImplemented(),
  deleteApi: async () => notImplemented(),
  listCasbin: async () => notImplemented(),
  replaceCasbin: async () => notImplemented(),
};
