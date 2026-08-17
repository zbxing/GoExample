'use client';

import { useEffect, useMemo, useState } from 'react';
import { AdminPage, AdminCard, AdminTable, AdminToolbar, useAdminToast } from '@/components/admin/admin-primitives';
import { apiFetch } from '@/lib/api/client';
import { Can } from '@/providers/auth-provider';
import type { CasbinPolicyRecord, HttpMethod, SystemApiRecord, SystemRoleRecord } from '@/lib/types/system';

export function SystemCasbinPage() {
  const { showSuccess, showError, ToastHost } = useAdminToast();
  const [roles, setRoles] = useState<SystemRoleRecord[]>([]);
  const [apis, setApis] = useState<SystemApiRecord[]>([]);
  const [policies, setPolicies] = useState<CasbinPolicyRecord[]>([]);
  const [roleId, setRoleId] = useState('888');
  const [draftByRole, setDraftByRole] = useState<Record<string, string[]>>({});
  const [reloadToken, setReloadToken] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      try {
        const [rolesPayload, apisPayload, casbinPayload] = await Promise.all([
          apiFetch<{ roles: SystemRoleRecord[] }>('/api/system/roles'),
          apiFetch<{ apis: SystemApiRecord[] }>('/api/system/apis'),
          apiFetch<{ policies: CasbinPolicyRecord[] }>('/api/system/casbin'),
        ]);
        if (cancelled) {
          return;
        }
        setRoles(rolesPayload.data.roles);
        setApis(apisPayload.data.apis);
        setPolicies(casbinPayload.data.policies);
        setDraftByRole({});
      } catch {
        // 列表加载失败不打断页面；交互操作使用 toast
      }
    }

    void sync();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const baselineKeys = useMemo(
    () =>
      policies
        .filter((policy) => policy.roleId === roleId)
        .map((policy) => `${policy.method} ${policy.path}`),
    [policies, roleId],
  );
  const selectedKeys = draftByRole[roleId] ?? baselineKeys;

  const rows = useMemo(
    () =>
      apis.map((api) => ({
        ...api,
        selected: selectedKeys.includes(`${api.method} ${api.path}`),
      })),
    [apis, selectedKeys],
  );

  function toggleKey(key: string) {
    setDraftByRole((current) => {
      const active = current[roleId] ?? baselineKeys;
      const next = active.includes(key)
        ? active.filter((item) => item !== key)
        : [...active, key];
      return { ...current, [roleId]: next };
    });
  }

  async function save() {
    setBusy(true);
    try {
      const nextPolicies = selectedKeys.map((key) => {
        const [method, ...pathParts] = key.split(' ');
        return { method: method as HttpMethod, path: pathParts.join(' ') };
      });
      await apiFetch('/api/system/casbin', {
        method: 'PUT',
        body: JSON.stringify({ roleId, policies: nextPolicies }),
      });
      setReloadToken((value) => value + 1);
      showSuccess('保存成功');
    } catch (err) {
      showError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPage>
      {ToastHost}
      <AdminCard>
      <AdminToolbar>
        <label className="gvaField" style={{ minWidth: 240 }}>
          <span>角色</span>
          <select value={roleId} onChange={(event) => setRoleId(event.target.value)}>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name} ({role.id})
              </option>
            ))}
          </select>
        </label>
        <Can btn="casbin:edit">
          <button
            type="button"
            className="elButton elButtonPrimary"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </Can>
      </AdminToolbar>
      <AdminTable
        columns={[
          {
            key: 'selected',
            title: '授权',
            width: 80,
            render: (row) => {
              const key = `${row.method} ${row.path}`;
              return (
                <input
                  type="checkbox"
                  checked={Boolean(row.selected)}
                  onChange={() => toggleKey(key)}
                />
              );
            },
          },
          { key: 'method', title: '方法', width: 90 },
          { key: 'path', title: '路径' },
          { key: 'apiGroup', title: '分组', width: 120 },
          { key: 'description', title: '描述' },
        ]}
        rows={rows as unknown as Array<Record<string, unknown>>}
      />
      </AdminCard>
    </AdminPage>
  );
}
