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
  useAdminToast,
} from '@/components/admin/admin-primitives';
import { apiFetch } from '@/lib/api/client';
import { Can } from '@/providers/auth-provider';
import type { HttpMethod, SystemApiRecord } from '@/lib/types/system';

export function SystemApisPage() {
  const { showSuccess, showError, ToastHost } = useAdminToast();
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [apis, setApis] = useState<SystemApiRecord[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<SystemApiRecord | null>(null);
  const [form, setForm] = useState({
    id: '',
    path: '',
    method: 'GET' as HttpMethod,
    apiGroup: 'system',
    description: '',
  });

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      try {
        const payload = await apiFetch<{ apis: SystemApiRecord[] }>(
          `/api/system/apis?search=${encodeURIComponent(search)}`,
        );
        if (!cancelled) {
          setApis(payload.data.apis);
        }
      } catch {
        // 列表加载失败不打断页面；交互操作使用 toast
      }
    }

    void sync();
    return () => {
      cancelled = true;
    };
  }, [search, reloadToken]);

  function openCreate() {
    setForm({ id: '', path: '', method: 'GET', apiGroup: 'system', description: '' });
    setDialogOpen(true);
  }

  function openEdit(api: SystemApiRecord) {
    setForm({ ...api });
    setDialogOpen(true);
  }

  async function saveApi() {
    setBusy(true);
    try {
      if (form.id) {
        await apiFetch('/api/system/apis', { method: 'PUT', body: JSON.stringify(form) });
        showSuccess('编辑成功');
      } else {
        const { id, ...body } = form;
        void id;
        await apiFetch('/api/system/apis', { method: 'POST', body: JSON.stringify(body) });
        showSuccess('创建成功');
      }
      setDialogOpen(false);
      setReloadToken((value) => value + 1);
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
      await apiFetch('/api/system/apis', {
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

  return (
    <AdminPage>
      {ToastHost}
      <AdminSearchForm
        onSearch={() => setSearch(searchDraft)}
        onReset={() => {
          setSearchDraft('');
          setSearch('');
        }}
      >
        <AdminField label="路径">
          <input
            value={searchDraft}
            placeholder="搜索 path / group / 描述"
            onChange={(event) => setSearchDraft(event.target.value)}
          />
        </AdminField>
      </AdminSearchForm>

      <AdminCard>
      <AdminToolbar>
        <Can btn="api:add">
          <button type="button" className="elButton elButtonPrimary" onClick={openCreate}>
            新增API
          </button>
        </Can>
      </AdminToolbar>

      <AdminTable
        columns={[
          { key: 'id', title: 'ID', width: 120 },
          { key: 'path', title: 'API路径' },
          { key: 'apiGroup', title: 'API分组', width: 120 },
          { key: 'description', title: 'API简介' },
          { key: 'method', title: '请求', width: 90 },
          {
            key: 'actions',
            title: '操作',
            width: 140,
            render: (row) => {
              const api = row as unknown as SystemApiRecord;
              return (
                <div className="gvaRowActions">
                  <Can btn="api:edit">
                    <AdminLinkButton onClick={() => openEdit(api)}>编辑</AdminLinkButton>
                  </Can>
                  <Can btn="api:delete">
                    <AdminLinkButton danger onClick={() => setDeleteTarget(api)}>
                      删除
                    </AdminLinkButton>
                  </Can>
                </div>
              );
            },
          },
        ]}
        rows={apis as unknown as Array<Record<string, unknown>>}
      />
      </AdminCard>

      <AdminDialog
        open={dialogOpen}
        title={form.id ? '编辑API' : '新增API'}
        onClose={() => setDialogOpen(false)}
        onConfirm={() => void saveApi()}
        busy={busy}
        width="40%"
      >
        <div className="adminForm gvaDialogForm">
          <AdminField label="请求方法">
            <select
              value={form.method}
              onChange={(event) =>
                setForm((current) => ({ ...current, method: event.target.value as HttpMethod }))
              }
            >
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </AdminField>
          <AdminField label="API路径">
            <input
              value={form.path}
              onChange={(event) => setForm((current) => ({ ...current, path: event.target.value }))}
            />
          </AdminField>
          <AdminField label="API分组">
            <input
              value={form.apiGroup}
              onChange={(event) =>
                setForm((current) => ({ ...current, apiGroup: event.target.value }))
              }
            />
          </AdminField>
          <AdminField label="API简介">
            <input
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
            />
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
