'use client';

import { useMemo, useState } from 'react';
import { IconPlus } from '@/components/admin/admin-icons';
import {
  AdminCard,
  AdminConfirmDialog,
  AdminDialog,
  AdminField,
  AdminLinkButton,
  AdminPage,
  AdminPagination,
  AdminSearchForm,
  AdminTable,
  AdminToolbar,
  AdminWarningBar,
  useAdminToast,
} from '@/components/admin/admin-primitives';

type PkgRow = {
  id: string;
  packageName: string;
  template: string;
  label: string;
  desc: string;
  createdAt: string;
};

const INITIAL: PkgRow[] = [
  {
    id: '1',
    packageName: 'example',
    template: 'package',
    label: '示例包',
    desc: '演示用业务包',
    createdAt: '2026-08-20 11:00:00',
  },
  {
    id: '2',
    packageName: 'plugin-demo',
    template: 'plugin',
    label: '插件演示',
    desc: '插件模板配置',
    createdAt: '2026-08-22 15:20:00',
  },
];

const emptyForm = { id: '', packageName: '', template: 'package', label: '', desc: '' };

export function AutoPkgPage() {
  const { showSuccess, showError, ToastHost } = useAdminToast();
  const [rows, setRows] = useState(INITIAL);
  const [keyword, setKeyword] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [form, setForm] = useState(emptyForm);
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PkgRow | null>(null);

  const filtered = useMemo(() => {
    if (!applied) return rows;
    return rows.filter(
      (row) =>
        row.packageName.includes(applied) ||
        row.label.includes(applied) ||
        row.desc.includes(applied),
    );
  }, [applied, rows]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  function save() {
    if (!form.packageName.trim() || !form.label.trim()) {
      showError('请填写包名与中文名');
      return;
    }
    if (form.id) {
      setRows((current) =>
        current.map((row) =>
          row.id === form.id
            ? {
                ...row,
                packageName: form.packageName,
                template: form.template,
                label: form.label,
                desc: form.desc,
              }
            : row,
        ),
      );
      showSuccess('更新成功');
    } else {
      setRows((current) => [
        {
          id: String(Date.now()),
          packageName: form.packageName,
          template: form.template,
          label: form.label,
          desc: form.desc,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        },
        ...current,
      ]);
      showSuccess('创建成功（演示，未真实生成代码）');
    }
    setOpen(false);
  }

  return (
    <AdminPage>
      <AdminWarningBar title="开发环境模板配置演示页：新增仅更新本地列表，不会写入服务端代码包。" />
      <AdminSearchForm
        onSearch={() => {
          setPage(1);
          setApplied(keyword);
        }}
        onReset={() => {
          setKeyword('');
          setApplied('');
          setPage(1);
        }}
      >
        <AdminField label="关键字">
          <input
            value={keyword}
            placeholder="包名 / 中文名"
            onChange={(event) => setKeyword(event.target.value)}
          />
        </AdminField>
      </AdminSearchForm>

      <AdminCard>
        <AdminToolbar>
          <button
            type="button"
            className="elButton elButtonPrimary"
            onClick={() => {
              setForm(emptyForm);
              setOpen(true);
            }}
          >
            <span className="elButtonIcon" aria-hidden="true">
              <IconPlus size={14} />
            </span>
            新增包
          </button>
        </AdminToolbar>

        <AdminTable
          columns={[
            { key: 'id', title: 'ID', width: 90 },
            { key: 'packageName', title: '包名', minWidth: 140 },
            { key: 'template', title: '模板', width: 120 },
            { key: 'label', title: '中文名', width: 140 },
            { key: 'desc', title: '描述' },
            { key: 'createdAt', title: '创建时间', width: 180 },
            {
              key: 'actions',
              title: '操作',
              width: 160,
              render: (row) => {
                const item = row as unknown as PkgRow;
                return (
                  <div className="fnaRowActions">
                    <AdminLinkButton
                      icon="edit"
                      onClick={() => {
                        setForm({
                          id: item.id,
                          packageName: item.packageName,
                          template: item.template,
                          label: item.label,
                          desc: item.desc,
                        });
                        setOpen(true);
                      }}
                    >
                      编辑
                    </AdminLinkButton>
                    <AdminLinkButton icon="delete" onClick={() => setDeleteTarget(item)}>
                      删除
                    </AdminLinkButton>
                  </div>
                );
              },
            },
          ]}
          rows={paged as unknown as Array<Record<string, unknown>>}
        />

        <AdminPagination
          page={page}
          pageSize={pageSize}
          total={filtered.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </AdminCard>

      <AdminDialog
        open={open}
        title={form.id ? '编辑模板配置' : '新增模板配置'}
        onClose={() => setOpen(false)}
        onConfirm={save}
        width={480}
      >
        <div className="adminForm fnaDialogForm">
          <AdminField label="包名">
            <input
              value={form.packageName}
              placeholder="英文包名"
              onChange={(event) => setForm((c) => ({ ...c, packageName: event.target.value }))}
            />
          </AdminField>
          <AdminField label="模板">
            <select
              value={form.template}
              onChange={(event) => setForm((c) => ({ ...c, template: event.target.value }))}
            >
              <option value="package">package</option>
              <option value="plugin">plugin</option>
            </select>
          </AdminField>
          <AdminField label="中文名">
            <input
              value={form.label}
              onChange={(event) => setForm((c) => ({ ...c, label: event.target.value }))}
            />
          </AdminField>
          <AdminField label="描述">
            <input
              value={form.desc}
              onChange={(event) => setForm((c) => ({ ...c, desc: event.target.value }))}
            />
          </AdminField>
        </div>
      </AdminDialog>

      <AdminConfirmDialog
        open={Boolean(deleteTarget)}
        title="确认删除"
        message="确定删除该模板配置吗？"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            setRows((current) => current.filter((row) => row.id !== deleteTarget.id));
            showSuccess('删除成功');
          }
          setDeleteTarget(null);
        }}
      />
      {ToastHost}
    </AdminPage>
  );
}
