'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconCompass,
  IconDelete,
  IconDownload,
  IconPlus,
  IconRefresh,
  IconUpload,
} from '@/components/admin/admin-icons';
import {
  AdminConfirmDialog,
  AdminDialog,
  AdminField,
  AdminLinkButton,
  AdminPage,
  AdminCard,
  AdminPagination,
  AdminSearchForm,
  AdminSelect,
  AdminTable,
  AdminToolbar,
  AdminWarningBar,
  useAdminToast,
} from '@/components/admin/admin-primitives';
import { apiFetch } from '@/lib/api/client';
import { useFnaListLoad } from '@/lib/hooks/use-fna-list-load';
import { Can } from '@/providers/auth-provider';
import type {
  CasbinPolicyRecord,
  HttpMethod,
  SystemApiRecord,
  SystemRoleRecord,
} from '@/lib/types/system';

type SyncApiItem = {
  path: string;
  method: HttpMethod;
  apiGroup: string;
  description: string;
};

type SyncPreview = {
  newApis: SyncApiItem[];
  deleteApis: SystemApiRecord[];
  ignoreApis: SyncApiItem[];
};

const METHOD_OPTIONS: Array<{ value: HttpMethod; label: string }> = [
  { value: 'POST', label: '创建' },
  { value: 'GET', label: '查看' },
  { value: 'PUT', label: '更新' },
  { value: 'DELETE', label: '删除' },
  { value: 'PATCH', label: '修改' },
];

const EMPTY_SEARCH = {
  path: '',
  description: '',
  apiGroup: '',
  method: '' as '' | HttpMethod,
};

function methodLabel(method: string) {
  return METHOD_OPTIONS.find((item) => item.value === method)?.label ?? method;
}

function downloadText(filename: string, content: string, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function SystemApisPage() {
  const { showSuccess, showError, ToastHost } = useAdminToast();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [searchDraft, setSearchDraft] = useState(EMPTY_SEARCH);
  const [search, setSearch] = useState(EMPTY_SEARCH);
  const [apis, setApis] = useState<SystemApiRecord[]>([]);
  const [roles, setRoles] = useState<SystemRoleRecord[]>([]);
  const [policies, setPolicies] = useState<CasbinPolicyRecord[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<SystemApiRecord | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [refreshOpen, setRefreshOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncData, setSyncData] = useState<SyncPreview>({
    newApis: [],
    deleteApis: [],
    ignoreApis: [],
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [assignTarget, setAssignTarget] = useState<SystemApiRecord | null>(null);
  const [assignRoleIds, setAssignRoleIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortKey, setSortKey] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<'ascending' | 'descending' | null>(null);
  const [form, setForm] = useState({
    id: '',
    path: '',
    method: 'GET' as HttpMethod,
    apiGroup: 'system',
    description: '',
  });

  useFnaListLoad(() => {
    let cancelled = false;

    async function sync() {
      try {
        const [apisPayload, rolesPayload, casbinPayload] = await Promise.all([
          apiFetch<{ apis: SystemApiRecord[] }>('/api/system/apis'),
          apiFetch<{ roles: SystemRoleRecord[] }>('/api/system/roles'),
          apiFetch<{ policies: CasbinPolicyRecord[] }>('/api/system/casbin'),
        ]);
        if (!cancelled) {
          setApis(apisPayload.data.apis);
          setRoles(rolesPayload.data.roles);
          setPolicies(casbinPayload.data.policies);
        }
      } catch {
        // 列表加载失败不打断页面；交互操作使用 toast
      }
    }

    void sync();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const apiGroupOptions = useMemo(() => {
    return Array.from(new Set(apis.map((api) => api.apiGroup).filter(Boolean))).sort();
  }, [apis]);

  const filteredApis = useMemo(() => {
    const path = search.path.trim().toLowerCase();
    const description = search.description.trim().toLowerCase();
    const apiGroup = search.apiGroup.trim().toLowerCase();
    const method = search.method;

    let next = apis.filter((api) => {
      if (path && !api.path.toLowerCase().includes(path)) {
        return false;
      }
      if (description && !api.description.toLowerCase().includes(description)) {
        return false;
      }
      if (apiGroup && api.apiGroup.toLowerCase() !== apiGroup) {
        return false;
      }
      if (method && api.method !== method) {
        return false;
      }
      return true;
    });

    if (sortKey && sortOrder) {
      const factor = sortOrder === 'ascending' ? 1 : -1;
      next = [...next].sort((left, right) => {
        const a = String((left as unknown as Record<string, unknown>)[sortKey] ?? '');
        const b = String((right as unknown as Record<string, unknown>)[sortKey] ?? '');
        return a.localeCompare(b, 'zh-CN', { numeric: true }) * factor;
      });
    }

    return next;
  }, [apis, search, sortKey, sortOrder]);

  const pagedApis = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredApis.slice(start, start + pageSize);
  }, [filteredApis, page, pageSize]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredApis.length / Math.max(pageSize, 1)));
    if (page > maxPage) {
      setPage(maxPage);
    }
  }, [filteredApis.length, page, pageSize]);

  function openCreate() {
    setForm({ id: '', path: '', method: 'GET', apiGroup: 'system', description: '' });
    setDialogOpen(true);
  }

  function openEdit(api: SystemApiRecord) {
    setForm({ ...api });
    setDialogOpen(true);
  }

  async function openAssign(api: SystemApiRecord) {
    setAssignTarget(api);
    const matched = policies
      .filter((policy) => policy.path === api.path && policy.method === api.method)
      .map((policy) => policy.roleId);
    setAssignRoleIds(Array.from(new Set(matched)));
    setAssignOpen(true);
  }

  function handleSort(key: string) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortOrder('ascending');
      return;
    }
    if (sortOrder === 'ascending') {
      setSortOrder('descending');
      return;
    }
    if (sortOrder === 'descending') {
      setSortKey('');
      setSortOrder(null);
      return;
    }
    setSortOrder('ascending');
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
      setSelectedIds((current) => current.filter((id) => id !== deleteTarget.id));
      setReloadToken((value) => value + 1);
    } catch (err) {
      showError(err instanceof Error ? err.message : '删除失败');
    }
  }

  async function confirmBatchDelete() {
    try {
      for (const id of selectedIds) {
        await apiFetch('/api/system/apis', {
          method: 'DELETE',
          body: JSON.stringify({ id }),
        });
      }
      showSuccess('删除成功');
      setBatchDeleteOpen(false);
      setSelectedIds([]);
      setReloadToken((value) => value + 1);
    } catch (err) {
      showError(err instanceof Error ? err.message : '删除失败');
    }
  }

  async function confirmAssignRole() {
    if (!assignTarget) {
      return;
    }
    setBusy(true);
    try {
      let working = [...policies];
      for (const role of roles) {
        const rolePolicies = working
          .filter((policy) => policy.roleId === role.id)
          .filter(
            (policy) =>
              !(policy.path === assignTarget.path && policy.method === assignTarget.method),
          )
          .map((policy) => ({ path: policy.path, method: policy.method }));

        if (assignRoleIds.includes(role.id)) {
          rolePolicies.push({ path: assignTarget.path, method: assignTarget.method });
        }

        const payload = await apiFetch<{ policies: CasbinPolicyRecord[] }>('/api/system/casbin', {
          method: 'PUT',
          body: JSON.stringify({ roleId: role.id, policies: rolePolicies }),
        });
        working = [
          ...working.filter((policy) => policy.roleId !== role.id),
          ...payload.data.policies,
        ];
      }
      setPolicies(working);
      showSuccess('分配成功');
      setAssignOpen(false);
    } catch (err) {
      showError(err instanceof Error ? err.message : '分配失败');
    } finally {
      setBusy(false);
    }
  }

  function exportApis() {
    downloadText(
      'apis-export.json',
      JSON.stringify(filteredApis, null, 2),
      'application/json;charset=utf-8',
    );
    showSuccess('导出成功');
  }

  function downloadTemplate() {
    downloadText(
      'api-template.json',
      JSON.stringify(
        [{ path: '/example', method: 'GET', apiGroup: 'example', description: '示例接口' }],
        null,
        2,
      ),
      'application/json;charset=utf-8',
    );
    showSuccess('模板已下载');
  }

  async function importApis(file: File) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Array<Partial<SystemApiRecord>>;
      if (!Array.isArray(parsed)) {
        throw new Error('导入文件格式不正确');
      }
      for (const item of parsed) {
        if (!item.path || !item.method || !item.apiGroup) {
          continue;
        }
        await apiFetch('/api/system/apis', {
          method: 'POST',
          body: JSON.stringify({
            path: item.path,
            method: item.method,
            apiGroup: item.apiGroup,
            description: item.description ?? '',
          }),
        });
      }
      showSuccess('导入成功');
      setReloadToken((value) => value + 1);
    } catch (err) {
      showError(err instanceof Error ? err.message : '导入失败');
    }
  }

  async function openSyncDrawer() {
    setSyncBusy(true);
    try {
      const payload = await apiFetch<SyncPreview>('/api/system/apis/sync');
      setSyncData(payload.data);
      setSyncOpen(true);
    } catch (err) {
      showError(err instanceof Error ? err.message : '同步预览失败');
    } finally {
      setSyncBusy(false);
    }
  }

  async function confirmRefresh() {
    setRefreshOpen(false);
    setReloadToken((value) => value + 1);
    showSuccess('刷新成功');
  }

  async function applySync() {
    setSyncBusy(true);
    try {
      const payload = await apiFetch<SyncPreview>('/api/system/apis/sync', {
        method: 'POST',
        body: JSON.stringify({
          action: 'apply',
          newApis: syncData.newApis,
          deleteApis: syncData.deleteApis.map((item) => ({ id: item.id })),
          ignoreApis: syncData.ignoreApis,
        }),
      });
      setSyncData(payload.data);
      setSyncOpen(false);
      setReloadToken((value) => value + 1);
      showSuccess('同步成功');
    } catch (err) {
      showError(err instanceof Error ? err.message : '同步失败');
    } finally {
      setSyncBusy(false);
    }
  }

  async function addOneSyncApi(item: SyncApiItem) {
    setSyncBusy(true);
    try {
      await apiFetch('/api/system/apis/sync', {
        method: 'POST',
        body: JSON.stringify({ action: 'add-one', item }),
      });
      setSyncData((current) => ({
        ...current,
        newApis: current.newApis.filter(
          (row) => !(row.path === item.path && row.method === item.method),
        ),
      }));
      setReloadToken((value) => value + 1);
      showSuccess('新增成功');
    } catch (err) {
      showError(err instanceof Error ? err.message : '新增失败');
    } finally {
      setSyncBusy(false);
    }
  }

  async function toggleIgnoreSyncApi(item: SyncApiItem, ignored: boolean) {
    setSyncBusy(true);
    try {
      const payload = await apiFetch<{ ignoreApis: SyncApiItem[] }>('/api/system/apis/sync', {
        method: 'POST',
        body: JSON.stringify({ action: 'ignore', item, ignored }),
      });
      setSyncData((current) => {
        if (ignored) {
          return {
            ...current,
            newApis: current.newApis.filter(
              (row) => !(row.path === item.path && row.method === item.method),
            ),
            ignoreApis: payload.data.ignoreApis,
          };
        }
        return {
          ...current,
          ignoreApis: payload.data.ignoreApis,
          newApis: [...current.newApis, item],
        };
      });
      showSuccess(ignored ? '已忽略' : '已取消忽略');
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setSyncBusy(false);
    }
  }

  return (
    <AdminPage>
      {ToastHost}
      <AdminSearchForm
        onSearch={() => {
          setSearch(searchDraft);
          setPage(1);
        }}
        onReset={() => {
          setSearchDraft(EMPTY_SEARCH);
          setSearch(EMPTY_SEARCH);
          setPage(1);
        }}
      >
        <AdminField label="路径">
          <input
            value={searchDraft.path}
            placeholder="路径"
            onChange={(event) =>
              setSearchDraft((current) => ({ ...current, path: event.target.value }))
            }
          />
        </AdminField>
        <AdminField label="描述">
          <input
            value={searchDraft.description}
            placeholder="描述"
            onChange={(event) =>
              setSearchDraft((current) => ({ ...current, description: event.target.value }))
            }
          />
        </AdminField>
        <AdminField label="API分组">
          <AdminSelect
            clearable
            value={searchDraft.apiGroup}
            placeholder="请选择"
            minWidth={208}
            options={apiGroupOptions.map((group) => ({ value: group, label: group }))}
            onChange={(apiGroup) => setSearchDraft((current) => ({ ...current, apiGroup }))}
          />
        </AdminField>
        <AdminField label="请求">
          <AdminSelect
            clearable
            value={searchDraft.method}
            placeholder="请选择"
            minWidth={208}
            options={METHOD_OPTIONS.map((item) => ({
              value: item.value,
              label: `${item.label}(${item.value})`,
            }))}
            onChange={(method) =>
              setSearchDraft((current) => ({
                ...current,
                method: method as '' | HttpMethod,
              }))
            }
          />
        </AdminField>
      </AdminSearchForm>

      <AdminCard>
        <AdminToolbar>
          <Can btn="api:add">
            <button type="button" className="elButton elButtonPrimary" onClick={openCreate}>
              <span className="elButtonIcon" aria-hidden="true">
                <IconPlus size={14} />
              </span>
              新增
            </button>
          </Can>
          <Can btn="api:delete">
            <button
              type="button"
              className="elButton"
              disabled={selectedIds.length === 0}
              onClick={() => setBatchDeleteOpen(true)}
            >
              <span className="elButtonIcon elButtonDangerIcon" aria-hidden="true">
                <IconDelete size={14} />
              </span>
              删除
            </button>
          </Can>
          <button type="button" className="elButton" onClick={() => setRefreshOpen(true)}>
            <span className="elButtonIcon" aria-hidden="true">
              <IconRefresh size={14} />
            </span>
            刷新缓存
          </button>
          <button
            type="button"
            className="elButton"
            disabled={syncBusy}
            onClick={() => void openSyncDrawer()}
          >
            <span className="elButtonIcon" aria-hidden="true">
              <IconCompass size={14} />
            </span>
            同步API
          </button>
          <button type="button" className="elButton elButtonPrimary" onClick={downloadTemplate}>
            <span className="elButtonIcon" aria-hidden="true">
              <IconDownload size={14} />
            </span>
            下载模板
          </button>
          <button type="button" className="elButton elButtonPrimary" onClick={exportApis}>
            <span className="elButtonIcon" aria-hidden="true">
              <IconDownload size={14} />
            </span>
            导出
          </button>
          <button
            type="button"
            className="elButton elButtonPrimary"
            onClick={() => importInputRef.current?.click()}
          >
            <span className="elButtonIcon" aria-hidden="true">
              <IconUpload size={14} />
            </span>
            导入
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) {
                void importApis(file);
              }
            }}
          />
        </AdminToolbar>

        <AdminTable
          selectable
          layout="fixed"
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          sortKey={sortKey}
          sortOrder={sortOrder}
          onSortChange={handleSort}
          columns={[
            { key: 'id', title: 'ID', width: 100, sortable: true },
            { key: 'path', title: 'API路径', width: '14%', sortable: true },
            { key: 'apiGroup', title: 'API分组', width: '12%', sortable: true },
            { key: 'description', title: 'API简介', width: '20%', sortable: true },
            {
              key: 'method',
              title: '请求',
              width: '12%',
              sortable: true,
              render: (row) => {
                const method = String(row.method ?? '');
                return (
                  <span>
                    {method} / {methodLabel(method)}
                  </span>
                );
              },
            },
            {
              key: 'actions',
              title: '操作',
              width: 280,
              render: (row) => {
                const api = row as unknown as SystemApiRecord;
                return (
                  <div className="fnaRowActions">
                    <Can btn="api:edit">
                      <AdminLinkButton icon="edit" onClick={() => openEdit(api)}>
                        编辑
                      </AdminLinkButton>
                    </Can>
                    <Can btn="api:edit">
                      <AdminLinkButton icon="user" onClick={() => void openAssign(api)}>
                        分配角色
                      </AdminLinkButton>
                    </Can>
                    <Can btn="api:delete">
                      <AdminLinkButton icon="delete" onClick={() => setDeleteTarget(api)}>
                        删除
                      </AdminLinkButton>
                    </Can>
                  </div>
                );
              },
            },
          ]}
          rows={pagedApis as unknown as Array<Record<string, unknown>>}
        />

        <AdminPagination
          page={page}
          pageSize={pageSize}
          total={filteredApis.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </AdminCard>

      <AdminDialog
        open={dialogOpen}
        title={form.id ? '编辑API' : '新增API'}
        onClose={() => setDialogOpen(false)}
        onConfirm={() => void saveApi()}
        busy={busy}
      >
        <div className="adminForm fnaDialogForm">
          <AdminField label="请求方法">
            <select
              value={form.method}
              onChange={(event) =>
                setForm((current) => ({ ...current, method: event.target.value as HttpMethod }))
              }
            >
              {METHOD_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}({item.value})
                </option>
              ))}
            </select>
          </AdminField>
          <AdminField label="API路径">
            <input
              value={form.path}
              placeholder="请输入api路径"
              onChange={(event) => setForm((current) => ({ ...current, path: event.target.value }))}
            />
          </AdminField>
          <AdminField label="API分组">
            <input
              value={form.apiGroup}
              placeholder="请输入组名称"
              onChange={(event) =>
                setForm((current) => ({ ...current, apiGroup: event.target.value }))
              }
            />
          </AdminField>
          <AdminField label="API简介">
            <input
              value={form.description}
              placeholder="请输入api介绍"
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
            />
          </AdminField>
        </div>
      </AdminDialog>

      <AdminDialog
        open={assignOpen}
        title={`分配角色 - ${assignTarget?.description || assignTarget?.path || ''}`}
        onClose={() => setAssignOpen(false)}
        onConfirm={() => void confirmAssignRole()}
        busy={busy}
      >
        <div className="adminCheckboxGrid">
          {roles.map((role) => (
            <label key={role.id} className="adminTreeItem">
              <input
                type="checkbox"
                checked={assignRoleIds.includes(role.id)}
                onChange={() =>
                  setAssignRoleIds((current) =>
                    current.includes(role.id)
                      ? current.filter((id) => id !== role.id)
                      : [...current, role.id],
                  )
                }
              />
              <span>
                {role.name} ({role.id})
              </span>
            </label>
          ))}
        </div>
      </AdminDialog>

      <AdminConfirmDialog
        open={Boolean(deleteTarget)}
        message="确定要删除吗?"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
      <AdminConfirmDialog
        open={batchDeleteOpen}
        message={`确定删除选中的 ${selectedIds.length} 条 API 吗?`}
        onCancel={() => setBatchDeleteOpen(false)}
        onConfirm={() => void confirmBatchDelete()}
      />
      <AdminConfirmDialog
        open={refreshOpen}
        message="确定要刷新缓存吗?"
        onCancel={() => setRefreshOpen(false)}
        onConfirm={() => void confirmRefresh()}
      />

      <AdminDialog
        open={syncOpen}
        title="同步路由"
        onClose={() => setSyncOpen(false)}
        onConfirm={() => void applySync()}
        busy={syncBusy}
      >
        <AdminWarningBar title="同步API，不输入路由分组将不会被自动同步，如果api不需要参与鉴权，可以按忽略按钮进行忽略。" />
        <h4 className="fnaSyncSectionTitle">
          新增路由
          <span className="fnaSyncSectionHint">存在于当前路由中，但是不存在于api表</span>
        </h4>
        <AdminTable
          columns={[
            { key: 'path', title: 'API路径' },
            {
              key: 'apiGroup',
              title: 'API分组',
              render: (row) => (
                <input
                  value={String(row.apiGroup ?? '')}
                  onChange={(event) => {
                    const next = event.target.value;
                    setSyncData((current) => ({
                      ...current,
                      newApis: current.newApis.map((item) =>
                        item.path === row.path && item.method === row.method
                          ? { ...item, apiGroup: next }
                          : item,
                      ),
                    }));
                  }}
                />
              ),
            },
            {
              key: 'description',
              title: 'API简介',
              render: (row) => (
                <input
                  value={String(row.description ?? '')}
                  onChange={(event) => {
                    const next = event.target.value;
                    setSyncData((current) => ({
                      ...current,
                      newApis: current.newApis.map((item) =>
                        item.path === row.path && item.method === row.method
                          ? { ...item, description: next }
                          : item,
                      ),
                    }));
                  }}
                />
              ),
            },
            {
              key: 'method',
              title: '请求',
              render: (row) => (
                <span>
                  {String(row.method)} / {methodLabel(String(row.method))}
                </span>
              ),
            },
            {
              key: 'actions',
              title: '操作',
              width: 180,
              render: (row) => {
                const item = row as unknown as SyncApiItem;
                return (
                  <div className="fnaRowActions">
                    <AdminLinkButton icon="edit" onClick={() => void addOneSyncApi(item)}>
                      单条新增
                    </AdminLinkButton>
                    <AdminLinkButton
                      icon="delete"
                      onClick={() => void toggleIgnoreSyncApi(item, true)}
                    >
                      忽略
                    </AdminLinkButton>
                  </div>
                );
              },
            },
          ]}
          rows={syncData.newApis as unknown as Array<Record<string, unknown>>}
          emptyText="暂无新增路由"
        />

        <h4 className="fnaSyncSectionTitle">
          已删除路由
          <span className="fnaSyncSectionHint">
            已经不存在于当前项目的路由中，确定同步后会自动从apis表删除
          </span>
        </h4>
        <AdminTable
          columns={[
            { key: 'path', title: 'API路径' },
            { key: 'apiGroup', title: 'API分组' },
            { key: 'description', title: 'API简介' },
            {
              key: 'method',
              title: '请求',
              render: (row) => (
                <span>
                  {String(row.method)} / {methodLabel(String(row.method))}
                </span>
              ),
            },
          ]}
          rows={syncData.deleteApis as unknown as Array<Record<string, unknown>>}
          emptyText="暂无待删除路由"
        />

        <h4 className="fnaSyncSectionTitle">
          忽略路由
          <span className="fnaSyncSectionHint">忽略路由不参与api同步，常见为不需要进行鉴权行为的路由</span>
        </h4>
        <AdminTable
          columns={[
            { key: 'path', title: 'API路径' },
            { key: 'apiGroup', title: 'API分组' },
            { key: 'description', title: 'API简介' },
            {
              key: 'method',
              title: '请求',
              render: (row) => (
                <span>
                  {String(row.method)} / {methodLabel(String(row.method))}
                </span>
              ),
            },
            {
              key: 'actions',
              title: '操作',
              width: 120,
              render: (row) => {
                const item = row as unknown as SyncApiItem;
                return (
                  <AdminLinkButton
                    icon="edit"
                    onClick={() => void toggleIgnoreSyncApi(item, false)}
                  >
                    取消忽略
                  </AdminLinkButton>
                );
              },
            },
          ]}
          rows={syncData.ignoreApis as unknown as Array<Record<string, unknown>>}
          emptyText="暂无忽略路由"
        />
      </AdminDialog>
    </AdminPage>
  );
}
