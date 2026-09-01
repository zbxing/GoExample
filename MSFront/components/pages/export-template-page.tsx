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
  useAdminToast,
} from '@/components/admin/admin-primitives';

type TemplateRow = {
  id: string;
  name: string;
  tableName: string;
  templateId: string;
  remark: string;
  updatedAt: string;
};

const INITIAL: TemplateRow[] = [
  {
    id: '1',
    name: '用户导出',
    tableName: 'sys_users',
    templateId: 'user_export',
    remark: '基础用户字段',
    updatedAt: '2026-08-18 10:00:00',
  },
  {
    id: '2',
    name: '操作日志导出',
    tableName: 'sys_operation_records',
    templateId: 'op_export',
    remark: '审计导出',
    updatedAt: '2026-08-25 16:40:00',
  },
];

const emptyForm = {
  id: '',
  name: '',
  tableName: '',
  templateId: '',
  remark: '',
  sql: 'SELECT id, username, created_at FROM sys_users',
  fields: 'id,username,created_at',
};

export function ExportTemplatePage() {
  const { showSuccess, showError, ToastHost } = useAdminToast();
  const [rows, setRows] = useState(INITIAL);
  const [keyword, setKeyword] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [form, setForm] = useState(emptyForm);
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TemplateRow | null>(null);

  const filtered = useMemo(() => {
    if (!applied) return rows;
    return rows.filter(
      (row) =>
        row.name.includes(applied) ||
        row.tableName.includes(applied) ||
        row.templateId.includes(applied),
    );
  }, [applied, rows]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  function save() {
    if (!form.name.trim() || !form.templateId.trim()) {
      showError('请填写模板名称与模板标识');
      return;
    }
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    if (form.id) {
      setRows((current) =>
        current.map((row) =>
          row.id === form.id
            ? {
                ...row,
                name: form.name,
                tableName: form.tableName,
                templateId: form.templateId,
                remark: form.remark,
                updatedAt: stamp,
              }
            : row,
        ),
      );
      showSuccess('保存成功');
    } else {
      setRows((current) => [
        {
          id: String(Date.now()),
          name: form.name,
          tableName: form.tableName,
          templateId: form.templateId,
          remark: form.remark,
          updatedAt: stamp,
        },
        ...current,
      ]);
      showSuccess('创建成功');
    }
    setOpen(false);
  }

  return (
    <AdminPage>
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
            placeholder="名称 / 表名 / 标识"
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
            新增模板
          </button>
        </AdminToolbar>

        <AdminTable
          columns={[
            { key: 'id', title: 'ID', width: 80 },
            { key: 'name', title: '模板名称', minWidth: 140 },
            { key: 'tableName', title: '关联表', minWidth: 160 },
            { key: 'templateId', title: '模板标识', width: 140 },
            { key: 'remark', title: '备注' },
            { key: 'updatedAt', title: '更新时间', width: 180 },
            {
              key: 'actions',
              title: '操作',
              width: 160,
              render: (row) => {
                const item = row as unknown as TemplateRow;
                return (
                  <div className="fnaRowActions">
                    <AdminLinkButton
                      icon="edit"
                      onClick={() => {
                        setForm({
                          id: item.id,
                          name: item.name,
                          tableName: item.tableName,
                          templateId: item.templateId,
                          remark: item.remark,
                          sql: `SELECT * FROM ${item.tableName}`,
                          fields: 'id,name,created_at',
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
        title={form.id ? '编辑导出模板' : '新增导出模板'}
        onClose={() => setOpen(false)}
        onConfirm={save}
        confirmLabel="保存"
        width={640}
      >
        <div className="adminForm fnaDialogForm">
          <AdminField label="模板名称">
            <input
              value={form.name}
              onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
            />
          </AdminField>
          <AdminField label="模板标识">
            <input
              value={form.templateId}
              onChange={(event) => setForm((c) => ({ ...c, templateId: event.target.value }))}
            />
          </AdminField>
          <AdminField label="关联表">
            <input
              value={form.tableName}
              onChange={(event) => setForm((c) => ({ ...c, tableName: event.target.value }))}
            />
          </AdminField>
          <AdminField label="导出字段">
            <input
              value={form.fields}
              placeholder="逗号分隔"
              onChange={(event) => setForm((c) => ({ ...c, fields: event.target.value }))}
            />
          </AdminField>
          <AdminField label="SQL">
            <textarea
              rows={4}
              value={form.sql}
              onChange={(event) => setForm((c) => ({ ...c, sql: event.target.value }))}
            />
          </AdminField>
          <AdminField label="备注">
            <input
              value={form.remark}
              onChange={(event) => setForm((c) => ({ ...c, remark: event.target.value }))}
            />
          </AdminField>
        </div>
      </AdminDialog>

      <AdminConfirmDialog
        open={Boolean(deleteTarget)}
        title="确认删除"
        message="确定删除该导出模板吗？"
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
