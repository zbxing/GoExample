'use client';

import { useEffect, useState } from 'react';
import {
  AdminConfirmDialog,
  AdminDialog,
  AdminField,
  AdminLinkButton,
  AdminPage,
  AdminCard,
  AdminSearchForm,
  AdminTable,
  AdminToolbar,
  AdminTree,
  useAdminToast,
} from '@/components/admin/admin-primitives';
import { apiFetch } from '@/lib/api/client';
import { Can, useAuth } from '@/providers/auth-provider';
import type {
  CasbinPolicyRecord,
  HttpMethod,
  SystemApiRecord,
  SystemMenuTreeNode,
  SystemRoleRecord,
} from '@/lib/types/system';

const allBtnOptions = [
  'user:add',
  'user:edit',
  'user:delete',
  'role:add',
  'role:edit',
  'role:delete',
  'role:bind',
  'menu:add',
  'menu:edit',
  'menu:delete',
  'api:add',
  'api:edit',
  'api:delete',
  'casbin:edit',
];

export function SystemRolesPage() {
  const { refresh } = useAuth();
  const { showSuccess, showError, ToastHost } = useAdminToast();
  const [roles, setRoles] = useState<SystemRoleRecord[]>([]);
  const [menus, setMenus] = useState<SystemMenuTreeNode[]>([]);
  const [apis, setApis] = useState<SystemApiRecord[]>([]);
  const [policies, setPolicies] = useState<CasbinPolicyRecord[]>([]);
  const [searchName, setSearchName] = useState('');
  const [appliedName, setAppliedName] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [bindOpen, setBindOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SystemRoleRecord | null>(null);
  const [form, setForm] = useState({
    id: '',
    name: '',
    description: '',
    defaultRouter: '/dashboard',
    menuIds: [] as string[],
    btnAuths: [] as string[],
  });
  const [reloadToken, setReloadToken] = useState(0);
  const [bindRoleId, setBindRoleId] = useState('');
  const [selectedApiKeys, setSelectedApiKeys] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      try {
        const [rolesPayload, menusPayload, apisPayload, casbinPayload] = await Promise.all([
          apiFetch<{ roles: SystemRoleRecord[] }>('/api/system/roles'),
          apiFetch<{ menus: SystemMenuTreeNode[] }>('/api/system/menus'),
          apiFetch<{ apis: SystemApiRecord[] }>('/api/system/apis'),
          apiFetch<{ policies: CasbinPolicyRecord[] }>('/api/system/casbin'),
        ]);
        if (cancelled) {
          return;
        }
        setRoles(rolesPayload.data.roles);
        setMenus(menusPayload.data.menus);
        setApis(apisPayload.data.apis);
        setPolicies(casbinPayload.data.policies);
      } catch {
        // 列表加载失败不打断页面；交互操作使用 toast
      }
    }

    void sync();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  function openCreate() {
    setEditing(false);
    setForm({
      id: '',
      name: '',
      description: '',
      defaultRouter: '/dashboard',
      menuIds: [],
      btnAuths: [],
    });
    setDialogOpen(true);
  }

  function openEdit(role: SystemRoleRecord) {
    setEditing(true);
    setForm({
      id: role.id,
      name: role.name,
      description: role.description,
      defaultRouter: role.defaultRouter,
      menuIds: role.menuIds,
      btnAuths: role.btnAuths,
    });
    setDialogOpen(true);
  }

  function openBind(role: SystemRoleRecord) {
    setBindRoleId(role.id);
    const keys = policies
      .filter((policy) => policy.roleId === role.id)
      .map((policy) => `${policy.method} ${policy.path}`);
    setSelectedApiKeys(keys);
    setBindOpen(true);
  }

  async function saveRole() {
    setBusy(true);
    try {
      if (editing) {
        await apiFetch('/api/system/roles', {
          method: 'PUT',
          body: JSON.stringify(form),
        });
        showSuccess('编辑成功');
      } else {
        await apiFetch('/api/system/roles', {
          method: 'POST',
          body: JSON.stringify(form),
        });
        showSuccess('创建成功');
      }
      setDialogOpen(false);
      setReloadToken((value) => value + 1);
      await refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function saveBind() {
    setBusy(true);
    try {
      const nextPolicies = selectedApiKeys.map((key) => {
        const [method, ...pathParts] = key.split(' ');
        return { method: method as HttpMethod, path: pathParts.join(' ') };
      });
      await apiFetch('/api/system/casbin', {
        method: 'PUT',
        body: JSON.stringify({ roleId: bindRoleId, policies: nextPolicies }),
      });
      showSuccess('角色设置成功');
      setBindOpen(false);
      setReloadToken((value) => value + 1);
    } catch (err) {
      showError(err instanceof Error ? err.message : '绑定失败');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return;
    }
    try {
      await apiFetch('/api/system/roles', {
        method: 'DELETE',
        body: JSON.stringify({ id: deleteTarget.id }),
      });
      showSuccess('删除成功');
      setDeleteTarget(null);
      setReloadToken((value) => value + 1);
      await refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : '删除失败');
    }
  }

  function toggleMenu(id: string) {
    setForm((current) => ({
      ...current,
      menuIds: current.menuIds.includes(id)
        ? current.menuIds.filter((item) => item !== id)
        : [...current.menuIds, id],
    }));
  }

  const visibleRoles = roles.filter((role) =>
    appliedName ? role.name.includes(appliedName) || role.id.includes(appliedName) : true,
  );

  return (
    <AdminPage>
      {ToastHost}
      <AdminSearchForm
        onSearch={() => setAppliedName(searchName)}
        onReset={() => {
          setSearchName('');
          setAppliedName('');
        }}
      >
        <AdminField label="角色名称">
          <input
            value={searchName}
            placeholder="请输入角色名称"
            onChange={(event) => setSearchName(event.target.value)}
          />
        </AdminField>
      </AdminSearchForm>

      <AdminCard>
      <AdminToolbar>
        <Can btn="role:add">
          <button type="button" className="elButton elButtonPrimary" onClick={openCreate}>
            新增角色
          </button>
        </Can>
      </AdminToolbar>

      <AdminTable
        columns={[
          { key: 'id', title: '角色 ID', width: 120 },
          { key: 'name', title: '角色名称', width: 160 },
          { key: 'description', title: '描述' },
          {
            key: 'menuIds',
            title: '菜单数',
            width: 90,
            render: (row) => String((row.menuIds as string[]).length),
          },
          {
            key: 'actions',
            title: '操作',
            width: 220,
            render: (row) => {
              const role = row as unknown as SystemRoleRecord;
              return (
                <div className="gvaRowActions">
                  <Can btn="role:edit">
                    <AdminLinkButton onClick={() => openEdit(role)}>编辑</AdminLinkButton>
                  </Can>
                  <Can btn="role:bind">
                    <AdminLinkButton onClick={() => openBind(role)}>设置权限</AdminLinkButton>
                  </Can>
                  <Can btn="role:delete">
                    <AdminLinkButton
                      danger
                      disabled={role.locked}
                      onClick={() => setDeleteTarget(role)}
                    >
                      删除
                    </AdminLinkButton>
                  </Can>
                </div>
              );
            },
          },
        ]}
        rows={visibleRoles as unknown as Array<Record<string, unknown>>}
      />
      </AdminCard>

      <AdminDialog
        open={dialogOpen}
        title={editing ? '编辑角色' : '新增角色'}
        onClose={() => setDialogOpen(false)}
        onConfirm={() => void saveRole()}
        busy={busy}
        width="40%"
      >
        <div className="adminForm gvaDialogForm">
          {!editing ? (
            <AdminField label="角色 ID">
              <input
                value={form.id}
                placeholder="可选，留空自动生成"
                onChange={(event) => setForm((current) => ({ ...current, id: event.target.value }))}
              />
            </AdminField>
          ) : null}
          <AdminField label="角色名称">
            <input
              value={form.name}
              placeholder="请输入角色名称"
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </AdminField>
          <AdminField label="描述">
            <textarea
              value={form.description}
              placeholder="请输入描述"
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
            />
          </AdminField>
          <AdminField label="默认路由">
            <input
              value={form.defaultRouter}
              onChange={(event) =>
                setForm((current) => ({ ...current, defaultRouter: event.target.value }))
              }
            />
          </AdminField>
          <AdminField label="菜单权限">
            <AdminTree nodes={menus} selectedIds={form.menuIds} onToggle={toggleMenu} />
          </AdminField>
          <AdminField label="按钮权限">
            <div className="adminCheckboxGrid">
              {allBtnOptions.map((btn) => (
                <label key={btn} className="adminTreeItem">
                  <input
                    type="checkbox"
                    checked={form.btnAuths.includes(btn)}
                    onChange={() =>
                      setForm((current) => ({
                        ...current,
                        btnAuths: current.btnAuths.includes(btn)
                          ? current.btnAuths.filter((item) => item !== btn)
                          : [...current.btnAuths, btn],
                      }))
                    }
                  />
                  <span>{btn}</span>
                </label>
              ))}
            </div>
          </AdminField>
        </div>
      </AdminDialog>

      <AdminDialog
        open={bindOpen}
        title={`设置权限 · ${bindRoleId}`}
        onClose={() => setBindOpen(false)}
        onConfirm={() => void saveBind()}
        busy={busy}
        confirmLabel="确 定"
        width={720}
      >
        <div className="adminCheckboxGrid">
          {apis.map((api) => {
            const key = `${api.method} ${api.path}`;
            return (
              <label key={api.id} className="adminTreeItem">
                <input
                  type="checkbox"
                  checked={selectedApiKeys.includes(key)}
                  onChange={() =>
                    setSelectedApiKeys((current) =>
                      current.includes(key)
                        ? current.filter((item) => item !== key)
                        : [...current, key],
                    )
                  }
                />
                <span>
                  [{api.method}] {api.path} · {api.description}
                </span>
              </label>
            );
          })}
        </div>
      </AdminDialog>

      <AdminConfirmDialog
        open={Boolean(deleteTarget)}
        message="确定要删除吗?"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </AdminPage>
  );
}
