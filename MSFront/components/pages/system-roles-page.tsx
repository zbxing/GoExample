'use client';

import { useMemo, useState } from 'react';
import { IconArrowRight, IconPlus } from '@/components/admin/admin-icons';
import {
  AdminConfirmDialog,
  AdminDialog,
  AdminField,
  AdminLinkButton,
  AdminPage,
  AdminCard,
  AdminPagination,
  AdminSearchForm,
  AdminTable,
  AdminToolbar,
  AdminTree,
  AdminWarningBar,
  useAdminToast,
} from '@/components/admin/admin-primitives';
import { apiFetch } from '@/lib/api/client';
import { useGvaListLoad } from '@/lib/hooks/use-gva-list-load';
import { Can, useAuth } from '@/providers/auth-provider';
import type {
  CasbinPolicyRecord,
  HttpMethod,
  SystemApiRecord,
  SystemMenuTreeNode,
  SystemRoleRecord,
  SystemUserPublic,
} from '@/lib/types/system';

const dataScopeOptions = [
  { value: 1 as const, label: '全部数据' },
  { value: 3 as const, label: '本部门' },
  { value: 2 as const, label: '本部门及以下' },
  { value: 4 as const, label: '仅本人' },
  { value: 5 as const, label: '自定义部门' },
];

type DialogType = 'add' | 'edit' | 'copy';

interface RoleTreeNode extends SystemRoleRecord {
  children: RoleTreeNode[];
}

function buildRoleTree(roles: SystemRoleRecord[]): RoleTreeNode[] {
  const map = new Map<string, RoleTreeNode>();
  for (const role of roles) {
    map.set(role.id, { ...role, dataScope: role.dataScope ?? 1, children: [] });
  }
  const roots: RoleTreeNode[] = [];
  for (const node of map.values()) {
    if (node.parentId && node.parentId !== '0' && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function flattenVisible(
  nodes: RoleTreeNode[],
  expanded: Set<string>,
  depth = 0,
): Array<RoleTreeNode & { depth: number; hasChildren: boolean }> {
  const rows: Array<RoleTreeNode & { depth: number; hasChildren: boolean }> = [];
  for (const node of nodes) {
    const hasChildren = node.children.length > 0;
    rows.push({ ...node, depth, hasChildren });
    if (hasChildren && expanded.has(node.id)) {
      rows.push(...flattenVisible(node.children, expanded, depth + 1));
    }
  }
  return rows;
}

function dataScopeLabel(value: number) {
  return dataScopeOptions.find((item) => item.value === value)?.label || '未设置';
}

export function SystemRolesPage() {
  const { refresh } = useAuth();
  const { showSuccess, showError, ToastHost } = useAdminToast();
  const [roles, setRoles] = useState<SystemRoleRecord[]>([]);
  const [menus, setMenus] = useState<SystemMenuTreeNode[]>([]);
  const [apis, setApis] = useState<SystemApiRecord[]>([]);
  const [policies, setPolicies] = useState<CasbinPolicyRecord[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['888']));
  const [reloadToken, setReloadToken] = useState(0);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState<DialogType>('add');
  const [dialogTitle, setDialogTitle] = useState('新增角色');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    id: '',
    name: '',
    parentId: '0',
    dataScope: 1 as 1 | 2 | 3 | 4 | 5,
  });
  const [copySourceId, setCopySourceId] = useState('');

  const [permOpen, setPermOpen] = useState(false);
  const [permTab, setPermTab] = useState<'menus' | 'apis'>('menus');
  const [activeRole, setActiveRole] = useState<SystemRoleRecord | null>(null);
  const [menuIds, setMenuIds] = useState<string[]>([]);
  const [btnAuths, setBtnAuths] = useState<string[]>([]);
  const [selectedApiKeys, setSelectedApiKeys] = useState<string[]>([]);

  const [deleteTarget, setDeleteTarget] = useState<SystemRoleRecord | null>(null);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignRole, setAssignRole] = useState<SystemRoleRecord | null>(null);
  const [assignUsers, setAssignUsers] = useState<SystemUserPublic[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [userSearchDraft, setUserSearchDraft] = useState({ username: '', nickname: '' });
  const [userSearchApplied, setUserSearchApplied] = useState({ username: '', nickname: '' });
  const [userPage, setUserPage] = useState(1);
  const [userPageSize, setUserPageSize] = useState(10);

  const allBtnOptions = useMemo(
    () => Array.from(new Set(roles.flatMap((role) => role.btnAuths).concat([
      'user:add', 'user:edit', 'user:delete',
      'role:add', 'role:edit', 'role:delete', 'role:bind',
      'menu:add', 'menu:edit', 'menu:delete',
      'api:add', 'api:edit', 'api:delete', 'casbin:edit',
    ]))),
    [roles],
  );

  useGvaListLoad(() => {
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
        // 列表加载失败不打断页面
      }
    }

    void sync();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const tree = useMemo(() => buildRoleTree(roles), [roles]);
  const visibleRows = useMemo(() => flattenVisible(tree, expanded), [tree, expanded]);

  function toggleExpand(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function openCreate(parentId = '0') {
    setDialogType('add');
    setDialogTitle('新增角色');
    setForm({ id: '', name: '', parentId, dataScope: 1 });
    setCopySourceId('');
    setDialogOpen(true);
  }

  function openEdit(role: SystemRoleRecord) {
    setDialogType('edit');
    setDialogTitle('编辑角色');
    setForm({
      id: role.id,
      name: role.name,
      parentId: role.parentId || '0',
      dataScope: role.dataScope ?? 1,
    });
    setCopySourceId('');
    setDialogOpen(true);
  }

  function openCopy(role: SystemRoleRecord) {
    setDialogType('copy');
    setDialogTitle('拷贝角色');
    setForm({
      id: '',
      name: `${role.name}_copy`,
      parentId: role.parentId || '0',
      dataScope: role.dataScope ?? 1,
    });
    setCopySourceId(role.id);
    setDialogOpen(true);
  }

  async function submitRoleForm() {
    if (!form.name.trim()) {
      showError('请输入角色名');
      return;
    }
    if (dialogType !== 'edit' && !/^[0-9]*[1-9][0-9]*$/.test(form.id.trim())) {
      showError('角色ID必须为正整数');
      return;
    }
    setBusy(true);
    try {
      if (dialogType === 'add') {
        await apiFetch('/api/system/roles', {
          method: 'POST',
          body: JSON.stringify({
            id: form.id.trim(),
            name: form.name.trim(),
            parentId: form.parentId || '0',
            dataScope: form.dataScope,
          }),
        });
        showSuccess('添加成功!');
      } else if (dialogType === 'edit') {
        await apiFetch('/api/system/roles', {
          method: 'PUT',
          body: JSON.stringify({
            id: form.id,
            name: form.name.trim(),
            parentId: form.parentId || '0',
            dataScope: form.dataScope,
          }),
        });
        showSuccess('添加成功!');
      } else {
        await apiFetch('/api/system/roles/copy', {
          method: 'POST',
          body: JSON.stringify({
            id: form.id.trim(),
            name: form.name.trim(),
            parentId: form.parentId || '0',
            oldAuthorityId: copySourceId,
            dataScope: form.dataScope,
          }),
        });
        showSuccess('复制成功！');
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

  async function changeDataScope(role: SystemRoleRecord, value: 1 | 2 | 3 | 4 | 5) {
    if (role.dataScope === value) {
      return;
    }
    if (value === 5) {
      showError('当前示例未接入部门树，暂不可选自定义部门');
      return;
    }
    try {
      await apiFetch('/api/system/roles', {
        method: 'PUT',
        body: JSON.stringify({ id: role.id, dataScope: value }),
      });
      showSuccess('数据权限设置成功');
      setReloadToken((token) => token + 1);
    } catch (err) {
      showError(err instanceof Error ? err.message : '设置失败');
    }
  }

  function openPermission(role: SystemRoleRecord) {
    setActiveRole(role);
    setMenuIds([...role.menuIds]);
    setBtnAuths([...role.btnAuths]);
    const keys = policies
      .filter((policy) => policy.roleId === role.id)
      .map((policy) => `${policy.method} ${policy.path}`);
    setSelectedApiKeys(keys);
    setPermTab('menus');
    setPermOpen(true);
  }

  async function savePermission() {
    if (!activeRole) {
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/api/system/roles', {
        method: 'PUT',
        body: JSON.stringify({
          id: activeRole.id,
          menuIds,
          btnAuths,
        }),
      });
      const nextPolicies = selectedApiKeys.map((key) => {
        const [method, ...pathParts] = key.split(' ');
        return { method: method as HttpMethod, path: pathParts.join(' ') };
      });
      await apiFetch('/api/system/casbin', {
        method: 'PUT',
        body: JSON.stringify({ roleId: activeRole.id, policies: nextPolicies }),
      });
      showSuccess('角色设置成功');
      setPermOpen(false);
      setReloadToken((value) => value + 1);
      await refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function openAssign(role: SystemRoleRecord) {
    setAssignRole(role);
    setUserSearchDraft({ username: '', nickname: '' });
    setUserSearchApplied({ username: '', nickname: '' });
    setUserPage(1);
    setAssignOpen(true);
    try {
      const payload = await apiFetch<{ users: SystemUserPublic[] }>('/api/system/users');
      const users = payload.data.users;
      setAssignUsers(users);
      setSelectedUserIds(users.filter((user) => user.roleIds.includes(role.id)).map((user) => user.id));
    } catch (err) {
      showError(err instanceof Error ? err.message : '加载用户失败');
    }
  }

  async function confirmAssign() {
    if (!assignRole) {
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/api/system/roles/users', {
        method: 'PUT',
        body: JSON.stringify({ roleId: assignRole.id, userIds: selectedUserIds }),
      });
      showSuccess('分配成功!');
      setAssignOpen(false);
    } catch (err) {
      showError(err instanceof Error ? err.message : '分配失败，请重试');
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
      showSuccess('删除成功!');
      setDeleteTarget(null);
      setReloadToken((value) => value + 1);
      await refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : '删除失败');
    }
  }

  const filteredAssignUsers = assignUsers.filter((user) => {
    if (userSearchApplied.username && !user.username.includes(userSearchApplied.username)) {
      return false;
    }
    if (userSearchApplied.nickname && !user.displayName.includes(userSearchApplied.nickname)) {
      return false;
    }
    return true;
  });
  const pagedAssignUsers = filteredAssignUsers.slice(
    (userPage - 1) * userPageSize,
    userPage * userPageSize,
  );

  const parentOptions = [
    { id: '0', name: '根角色(严格模式下为当前用户角色)' },
    ...roles.map((role) => ({ id: role.id, name: role.name })),
  ];

  return (
    <AdminPage>
      {ToastHost}
      <AdminWarningBar title="注：右上角头像下拉可切换角色" />

      <AdminCard>
        <AdminToolbar>
          <Can btn="role:add">
            <button type="button" className="elButton elButtonPrimary" onClick={() => openCreate('0')}>
              <span className="elButtonIcon" aria-hidden="true">
                <IconPlus size={14} />
              </span>
              新增角色
            </button>
          </Can>
        </AdminToolbar>

        <AdminTable
          columns={[
            {
              key: 'id',
              title: '角色ID',
              width: 180,
              render: (row) => {
                const role = row as unknown as RoleTreeNode & {
                  depth: number;
                  hasChildren: boolean;
                };
                return (
                  <div className="gvaRoleIdCell" style={{ paddingLeft: role.depth * 18 }}>
                    {role.hasChildren ? (
                      <button
                        type="button"
                        className={
                          expanded.has(role.id) ? 'gvaTreeExpand is-expanded' : 'gvaTreeExpand'
                        }
                        aria-label={expanded.has(role.id) ? '折叠' : '展开'}
                        aria-expanded={expanded.has(role.id)}
                        onClick={() => toggleExpand(role.id)}
                      >
                        <IconArrowRight size={12} />
                      </button>
                    ) : (
                      <span className="gvaTreeExpandSpacer" />
                    )}
                    <span>{role.id}</span>
                  </div>
                );
              },
            },
            { key: 'name', title: '角色名称', width: 180 },
            {
              key: 'dataScope',
              title: '数据权限',
              width: 150,
              render: (row) => {
                const role = row as unknown as SystemRoleRecord;
                return (
                  <details className="gvaDataScopeDrop">
                    <summary className="gvaLinkButton">
                      {dataScopeLabel(role.dataScope ?? 1)}
                      <span aria-hidden="true"> ▾</span>
                    </summary>
                    <div className="gvaDataScopeMenu">
                      {dataScopeOptions.map((item) => (
                        <button
                          key={item.value}
                          type="button"
                          disabled={(role.dataScope ?? 1) === item.value}
                          onClick={() => void changeDataScope(role, item.value)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </details>
                );
              },
            },
            {
              key: 'actions',
              title: '操作',
              width: 560,
              render: (row) => {
                const role = row as unknown as SystemRoleRecord;
                return (
                  <div className="gvaRowActions">
                    <Can btn="role:bind">
                      <AdminLinkButton icon="setting" onClick={() => openPermission(role)}>
                        设置权限
                      </AdminLinkButton>
                    </Can>
                    <Can btn="role:edit">
                      <AdminLinkButton icon="user" onClick={() => void openAssign(role)}>
                        分配给用户
                      </AdminLinkButton>
                    </Can>
                    <Can btn="role:add">
                      <AdminLinkButton icon="plus" onClick={() => openCreate(role.id)}>
                        新增子角色
                      </AdminLinkButton>
                    </Can>
                    <Can btn="role:add">
                      <AdminLinkButton icon="copy" onClick={() => openCopy(role)}>
                        拷贝
                      </AdminLinkButton>
                    </Can>
                    <Can btn="role:edit">
                      <AdminLinkButton icon="edit" onClick={() => openEdit(role)}>
                        编辑
                      </AdminLinkButton>
                    </Can>
                    <Can btn="role:delete">
                      <AdminLinkButton
                        icon="delete"
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
          rows={visibleRows as unknown as Array<Record<string, unknown>>}
        />
      </AdminCard>

      <AdminDialog
        open={dialogOpen}
        title={dialogTitle}
        onClose={() => setDialogOpen(false)}
        onConfirm={() => void submitRoleForm()}
        busy={busy}
      >
        <div className="adminForm gvaDialogForm">
          <AdminField label="父级角色">
            <select
              value={form.parentId}
              disabled={dialogType === 'add'}
              onChange={(event) => setForm((current) => ({ ...current, parentId: event.target.value }))}
            >
              {parentOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </AdminField>
          <AdminField label="角色ID">
            <input
              value={form.id}
              disabled={dialogType === 'edit'}
              maxLength={15}
              placeholder="请输入正整数"
              onChange={(event) => setForm((current) => ({ ...current, id: event.target.value }))}
            />
          </AdminField>
          <AdminField label="角色姓名">
            <input
              value={form.name}
              placeholder="请输入角色名"
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </AdminField>
        </div>
      </AdminDialog>

      <AdminDialog
        open={permOpen}
        title="角色配置"
        onClose={() => setPermOpen(false)}
        onConfirm={() => void savePermission()}
        busy={busy}
        confirmLabel="确 定"
      >
        <div className="gvaBorderTabs">
          <div className="gvaBorderTabNav">
            <button
              type="button"
              className={permTab === 'menus' ? 'is-active' : ''}
              onClick={() => setPermTab('menus')}
            >
              角色菜单
            </button>
            <button
              type="button"
              className={permTab === 'apis' ? 'is-active' : ''}
              onClick={() => setPermTab('apis')}
            >
              角色api
            </button>
          </div>
          <div className="gvaBorderTabBody">
            {permTab === 'menus' ? (
              <div className="adminForm gvaDialogForm">
                <AdminField label="菜单权限">
                  <AdminTree
                    nodes={menus}
                    selectedIds={menuIds}
                    onToggle={(id) =>
                      setMenuIds((current) =>
                        current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
                      )
                    }
                  />
                </AdminField>
                <AdminField label="按钮权限">
                  <div className="adminCheckboxGrid">
                    {allBtnOptions.map((btn) => (
                      <label key={btn} className="adminTreeItem">
                        <input
                          type="checkbox"
                          checked={btnAuths.includes(btn)}
                          onChange={() =>
                            setBtnAuths((current) =>
                              current.includes(btn)
                                ? current.filter((item) => item !== btn)
                                : [...current, btn],
                            )
                          }
                        />
                        <span>{btn}</span>
                      </label>
                    ))}
                  </div>
                </AdminField>
              </div>
            ) : (
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
            )}
          </div>
        </div>
      </AdminDialog>

      <AdminDialog
        open={assignOpen}
        title={assignRole ? `分配用户 - ${assignRole.name}` : '分配用户'}
        onClose={() => setAssignOpen(false)}
        onConfirm={() => void confirmAssign()}
        busy={busy}
        confirmLabel="确 定"
      >
        <AdminWarningBar title="注：保存时将全量覆盖该角色的用户关联关系；若用户仅剩此一个角色，移除后其主角色保持不变" />
        <AdminSearchForm
          onSearch={() => {
            setUserPage(1);
            setUserSearchApplied(userSearchDraft);
          }}
          onReset={() => {
            setUserSearchDraft({ username: '', nickname: '' });
            setUserSearchApplied({ username: '', nickname: '' });
            setUserPage(1);
          }}
        >
          <AdminField label="用户名">
            <input
              value={userSearchDraft.username}
              placeholder="请输入用户名"
              onChange={(event) =>
                setUserSearchDraft((current) => ({ ...current, username: event.target.value }))
              }
            />
          </AdminField>
          <AdminField label="昵称">
            <input
              value={userSearchDraft.nickname}
              placeholder="请输入昵称"
              onChange={(event) =>
                setUserSearchDraft((current) => ({ ...current, nickname: event.target.value }))
              }
            />
          </AdminField>
        </AdminSearchForm>
        <AdminTable
          selectable
          selectedIds={selectedUserIds.filter((id) =>
            pagedAssignUsers.some((user) => user.id === id),
          )}
          onSelectionChange={(ids) => {
            const pageIds = new Set(pagedAssignUsers.map((user) => user.id));
            setSelectedUserIds((current) => [
              ...current.filter((id) => !pageIds.has(id)),
              ...ids,
            ]);
          }}
          columns={[
            { key: 'id', title: 'ID', width: 80 },
            { key: 'username', title: '用户名', width: 120 },
            { key: 'displayName', title: '昵称', width: 120 },
          ]}
          rows={pagedAssignUsers as unknown as Array<Record<string, unknown>>}
        />
        <AdminPagination
          page={userPage}
          pageSize={userPageSize}
          total={filteredAssignUsers.length}
          onPageChange={setUserPage}
          onPageSizeChange={(size) => {
            setUserPageSize(size);
            setUserPage(1);
          }}
        />
      </AdminDialog>

      <AdminConfirmDialog
        open={Boolean(deleteTarget)}
        message="此操作将永久删除该角色, 是否继续?"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </AdminPage>
  );
}
