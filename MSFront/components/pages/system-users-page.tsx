'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AdminConfirmDialog,
  AdminDialog,
  AdminField,
  AdminLinkButton,
  AdminPage,
  AdminCard,
  AdminPagination,
  AdminSearchForm,
  AdminSwitch,
  AdminTable,
  AdminToolbar,
  AdminWarningBar,
  useAdminToast,
} from '@/components/admin/admin-primitives';
import { apiFetch } from '@/lib/api/client';
import { Can, useAuth } from '@/providers/auth-provider';
import type { SystemRoleRecord, SystemUserPublic } from '@/lib/types/system';

interface UserFormState {
  id?: string;
  username: string;
  password: string;
  displayName: string;
  email: string;
  phone: string;
  status: 'active' | 'disabled';
  roleIds: string[];
}

interface SearchState {
  username: string;
  nickname: string;
  phone: string;
  email: string;
}

const emptyForm: UserFormState = {
  username: '',
  password: '',
  displayName: '',
  email: '',
  phone: '',
  status: 'active',
  roleIds: [],
};

const emptySearch: SearchState = {
  username: '',
  nickname: '',
  phone: '',
  email: '',
};

export function SystemUsersPage() {
  const { refresh } = useAuth();
  const { showSuccess, showError, ToastHost } = useAdminToast();
  const [searchDraft, setSearchDraft] = useState<SearchState>(emptySearch);
  const [searchApplied, setSearchApplied] = useState<SearchState>(emptySearch);
  const [users, setUsers] = useState<SystemUserPublic[]>([]);
  const [roles, setRoles] = useState<SystemRoleRecord[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<UserFormState>(emptyForm);
  const [resetTarget, setResetTarget] = useState<SystemUserPublic | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SystemUserPublic | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      try {
        const keyword = [searchApplied.username, searchApplied.nickname, searchApplied.phone, searchApplied.email]
          .filter(Boolean)
          .join(' ');
        const [usersPayload, rolesPayload] = await Promise.all([
          apiFetch<{ users: SystemUserPublic[] }>(
            `/api/system/users?search=${encodeURIComponent(keyword)}`,
          ),
          apiFetch<{ roles: SystemRoleRecord[] }>('/api/system/roles'),
        ]);
        if (cancelled) {
          return;
        }
        const filtered = usersPayload.data.users.filter((user) => {
          if (searchApplied.username && !user.username.includes(searchApplied.username)) {
            return false;
          }
          if (searchApplied.nickname && !user.displayName.includes(searchApplied.nickname)) {
            return false;
          }
          if (searchApplied.phone && !user.phone.includes(searchApplied.phone)) {
            return false;
          }
          if (searchApplied.email && !user.email.includes(searchApplied.email)) {
            return false;
          }
          return true;
        });
        setUsers(filtered);
        setRoles(rolesPayload.data.roles);
      } catch {
        // 列表加载失败不打断页面；交互操作使用 toast
      }
    }

    void sync();
    return () => {
      cancelled = true;
    };
  }, [reloadToken, searchApplied]);

  const pagedUsers = useMemo(() => {
    const start = (page - 1) * pageSize;
    return users.slice(start, start + pageSize);
  }, [page, pageSize, users]);

  function openCreate() {
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEdit(user: SystemUserPublic) {
    setForm({
      id: user.id,
      username: user.username,
      password: '',
      displayName: user.displayName,
      email: user.email,
      phone: user.phone,
      status: user.status,
      roleIds: user.roleIds,
    });
    setDialogOpen(true);
  }

  async function saveUser() {
    if (!form.id) {
      if (form.username.trim().length < 5) {
        showError('请输入用户名（至少5位）');
        return;
      }
      if (form.password.length < 6) {
        showError('请输入密码（至少6位）');
        return;
      }
    }
    if (!form.displayName.trim()) {
      showError('请输入用户昵称');
      return;
    }
    if (!form.roleIds.length) {
      showError('请选择用户角色');
      return;
    }

    setBusy(true);
    try {
      if (form.id) {
        await apiFetch('/api/system/users', {
          method: 'PUT',
          body: JSON.stringify({
            id: form.id,
            displayName: form.displayName,
            email: form.email,
            phone: form.phone,
            status: form.status,
            roleIds: form.roleIds,
            password: form.password || undefined,
          }),
        });
        showSuccess('编辑成功');
      } else {
        await apiFetch('/api/system/users', {
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

  async function confirmDelete() {
    if (!deleteTarget) {
      return;
    }
    try {
      await apiFetch('/api/system/users', {
        method: 'DELETE',
        body: JSON.stringify({ id: deleteTarget.id }),
      });
      showSuccess('删除成功');
      setDeleteTarget(null);
      setReloadToken((value) => value + 1);
    } catch (err) {
      showError(err instanceof Error ? err.message : '删除失败');
    }
  }

  async function toggleEnable(user: SystemUserPublic) {
    try {
      await apiFetch('/api/system/users', {
        method: 'PUT',
        body: JSON.stringify({
          id: user.id,
          status: user.status === 'active' ? 'disabled' : 'active',
        }),
      });
      showSuccess(`${user.status === 'active' ? '禁用' : '启用'}成功`);
      setReloadToken((value) => value + 1);
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败');
    }
  }

  async function confirmResetPassword() {
    if (!resetTarget || !resetPassword) {
      showError('请输入或生成密码');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/api/system/users', {
        method: 'PUT',
        body: JSON.stringify({ id: resetTarget.id, password: resetPassword }),
      });
      showSuccess('密码重置成功');
      setResetOpen(false);
      setResetPassword('');
      setResetTarget(null);
    } catch (err) {
      showError(err instanceof Error ? err.message : '密码重置失败');
    } finally {
      setBusy(false);
    }
  }

  function generateRandomPassword() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < 12; i += 1) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setResetPassword(password);
    void navigator.clipboard.writeText(password).then(
      () => showSuccess('密码已复制到剪贴板'),
      () => showError('复制失败，请手动复制'),
    );
  }

  return (
    <AdminPage>
      {ToastHost}
      <AdminWarningBar title="注：右上角头像下拉可切换角色" />
      <AdminSearchForm
        onSearch={() => {
          setPage(1);
          setSearchApplied(searchDraft);
        }}
        onReset={() => {
          setSearchDraft(emptySearch);
          setSearchApplied(emptySearch);
          setPage(1);
        }}
      >
        <AdminField label="用户名">
          <input
            value={searchDraft.username}
            placeholder="用户名"
            onChange={(event) =>
              setSearchDraft((current) => ({ ...current, username: event.target.value }))
            }
          />
        </AdminField>
        <AdminField label="昵称">
          <input
            value={searchDraft.nickname}
            placeholder="昵称"
            onChange={(event) =>
              setSearchDraft((current) => ({ ...current, nickname: event.target.value }))
            }
          />
        </AdminField>
        <AdminField label="手机号">
          <input
            value={searchDraft.phone}
            placeholder="手机号"
            onChange={(event) =>
              setSearchDraft((current) => ({ ...current, phone: event.target.value }))
            }
          />
        </AdminField>
        <AdminField label="邮箱">
          <input
            value={searchDraft.email}
            placeholder="邮箱"
            onChange={(event) =>
              setSearchDraft((current) => ({ ...current, email: event.target.value }))
            }
          />
        </AdminField>
      </AdminSearchForm>

      <AdminCard>
      <AdminToolbar>
        <Can btn="user:add">
          <button type="button" className="elButton elButtonPrimary" onClick={openCreate}>
            新增用户
          </button>
        </Can>
      </AdminToolbar>

      <AdminTable
        columns={[
          { key: 'id', title: 'ID', width: 120 },
          { key: 'username', title: '用户名', width: 120 },
          { key: 'displayName', title: '昵称', width: 120 },
          {
            key: 'roleNames',
            title: '用户角色',
            render: (row) => (row.roleNames as string[]).join(' / ') || '-',
          },
          { key: 'phone', title: '手机号', width: 130 },
          { key: 'email', title: '邮箱' },
          {
            key: 'status',
            title: '用户状态',
            width: 120,
            render: (row) => {
              const user = row as unknown as SystemUserPublic;
              return (
                <Can btn="user:edit" fallback={<span>{user.status === 'active' ? '启用' : '禁用'}</span>}>
                  <AdminSwitch
                    checked={user.status === 'active'}
                    onChange={() => void toggleEnable(user)}
                  />
                </Can>
              );
            },
          },
          {
            key: 'actions',
            title: '操作',
            width: 220,
            render: (row) => {
              const user = row as unknown as SystemUserPublic;
              return (
                <div className="gvaRowActions">
                  <Can btn="user:edit">
                    <AdminLinkButton onClick={() => openEdit(user)}>编辑</AdminLinkButton>
                  </Can>
                  <Can btn="user:edit">
                    <AdminLinkButton
                      onClick={() => {
                        setResetTarget(user);
                        setResetPassword('');
                        setResetOpen(true);
                      }}
                    >
                      重置密码
                    </AdminLinkButton>
                  </Can>
                  <Can btn="user:delete">
                    <AdminLinkButton danger onClick={() => setDeleteTarget(user)}>
                      删除
                    </AdminLinkButton>
                  </Can>
                </div>
              );
            },
          },
        ]}
        rows={pagedUsers as unknown as Array<Record<string, unknown>>}
      />

      <AdminPagination
        page={page}
        pageSize={pageSize}
        total={users.length}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
      </AdminCard>

      <AdminDialog
        open={dialogOpen}
        title="用户"
        onClose={() => setDialogOpen(false)}
        onConfirm={() => void saveUser()}
        busy={busy}
        width="40%"
      >
        <div className="adminForm gvaDialogForm">
          {!form.id ? (
            <AdminField label="用户名">
              <input
                value={form.username}
                placeholder="请输入用户名"
                onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
              />
            </AdminField>
          ) : (
            <AdminField label="用户名">
              <input value={form.username} disabled />
            </AdminField>
          )}
          {!form.id ? (
            <AdminField label="密码">
              <input
                type="password"
                value={form.password}
                placeholder="请输入密码"
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
              />
            </AdminField>
          ) : null}
          <AdminField label="昵称">
            <input
              value={form.displayName}
              placeholder="请输入用户昵称"
              onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
            />
          </AdminField>
          <AdminField label="手机号">
            <input
              value={form.phone}
              placeholder="请输入手机号"
              onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
            />
          </AdminField>
          <AdminField label="邮箱">
            <input
              value={form.email}
              placeholder="请输入邮箱"
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            />
          </AdminField>
          <AdminField label="用户角色">
            <div className="adminCheckboxGrid">
              {roles.map((role) => (
                <label key={role.id} className="adminTreeItem">
                  <input
                    type="checkbox"
                    checked={form.roleIds.includes(role.id)}
                    onChange={() =>
                      setForm((current) => ({
                        ...current,
                        roleIds: current.roleIds.includes(role.id)
                          ? current.roleIds.filter((id) => id !== role.id)
                          : [...current.roleIds, role.id],
                      }))
                    }
                  />
                  <span>{role.name}</span>
                </label>
              ))}
            </div>
          </AdminField>
          <AdminField label="用户状态">
            <select
              value={form.status}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  status: event.target.value as 'active' | 'disabled',
                }))
              }
            >
              <option value="active">启用</option>
              <option value="disabled">禁用</option>
            </select>
          </AdminField>
        </div>
      </AdminDialog>

      <AdminDialog
        open={resetOpen}
        title="重置密码"
        variant="dialog"
        width={500}
        onClose={() => setResetOpen(false)}
        onConfirm={() => void confirmResetPassword()}
        busy={busy}
      >
        <div className="adminForm gvaDialogForm">
          <AdminField label="用户">
            <input value={resetTarget?.username ?? ''} disabled />
          </AdminField>
          <AdminField label="新密码">
            <div className="gvaInlineActions">
              <input
                value={resetPassword}
                placeholder="请输入或生成密码"
                onChange={(event) => setResetPassword(event.target.value)}
              />
              <button type="button" className="elButton" onClick={generateRandomPassword}>
                生成随机密码
              </button>
            </div>
          </AdminField>
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
