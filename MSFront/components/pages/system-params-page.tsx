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

type ParamRow = {
  id: string;
  name: string;
  key: string;
  value: string;
  desc: string;
  createdAt: string;
};

const INITIAL: ParamRow[] = [
  {
    id: '1',
    name: '????',
    key: 'system.name',
    value: 'FNA Admin',
    desc: '??????',
    createdAt: '2026-08-01 12:00:00',
  },
  {
    id: '2',
    name: '?????',
    key: 'system.pageSize',
    value: '10',
    desc: '??????',
    createdAt: '2026-08-01 12:00:00',
  },
  {
    id: '3',
    name: '??????',
    key: 'upload.maxSizeMb',
    value: '50',
    desc: '?? MB',
    createdAt: '2026-08-12 09:30:00',
  },
];

const emptyForm = { id: '', name: '', key: '', value: '', desc: '' };

export function SystemParamsPage() {
  const { showSuccess, showError, ToastHost } = useAdminToast();
  const [rows, setRows] = useState(INITIAL);
  const [draft, setDraft] = useState({ name: '', key: '' });
  const [applied, setApplied] = useState({ name: '', key: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [form, setForm] = useState(emptyForm);
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ParamRow | null>(null);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (applied.name && !row.name.includes(applied.name)) return false;
      if (applied.key && !row.key.includes(applied.key)) return false;
      return true;
    });
  }, [applied, rows]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  function save() {
    if (!form.name.trim() || !form.key.trim()) {
      showError('???????????');
      return;
    }
    if (form.id) {
      setRows((current) =>
        current.map((row) => (row.id === form.id ? { ...row, ...form } : row)),
      );
      showSuccess('????');
    } else {
      setRows((current) => [
        {
          id: String(Date.now()),
          name: form.name,
          key: form.key,
          value: form.value,
          desc: form.desc,
          createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        },
        ...current,
      ]);
      showSuccess('????');
    }
    setOpen(false);
  }

  return (
    <AdminPage>
      <AdminWarningBar title="????????????? utils ?????????????" />
      <AdminSearchForm
        onSearch={() => {
          setPage(1);
          setApplied(draft);
        }}
        onReset={() => {
          setDraft({ name: '', key: '' });
          setApplied({ name: '', key: '' });
          setPage(1);
        }}
      >
        <AdminField label="????">
          <input
            value={draft.name}
            placeholder="????"
            onChange={(event) => setDraft((c) => ({ ...c, name: event.target.value }))}
          />
        </AdminField>
        <AdminField label="???">
          <input
            value={draft.key}
            placeholder="????"
            onChange={(event) => setDraft((c) => ({ ...c, key: event.target.value }))}
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
            ????
          </button>
        </AdminToolbar>

        <AdminTable
          columns={[
            { key: 'id', title: 'ID', width: 90 },
            { key: 'name', title: '????', width: 140 },
            { key: 'key', title: '???', minWidth: 160 },
            { key: 'value', title: '???', minWidth: 140 },
            { key: 'desc', title: '??' },
            { key: 'createdAt', title: '????', width: 180 },
            {
              key: 'actions',
              title: '??',
              width: 160,
              render: (row) => {
                const item = row as unknown as ParamRow;
                return (
                  <div className="fnaRowActions">
                    <AdminLinkButton
                      icon="edit"
                      onClick={() => {
                        setForm({
                          id: item.id,
                          name: item.name,
                          key: item.key,
                          value: item.value,
                          desc: item.desc,
                        });
                        setOpen(true);
                      }}
                    >
                      ??
                    </AdminLinkButton>
                    <AdminLinkButton icon="delete" onClick={() => setDeleteTarget(item)}>
                      ??
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
        title={form.id ? '????' : '????'}
        onClose={() => setOpen(false)}
        onConfirm={save}
        width={480}
      >
        <div className="adminForm fnaDialogForm">
          <AdminField label="????">
            <input
              value={form.name}
              placeholder="???????"
              onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
            />
          </AdminField>
          <AdminField label="???">
            <input
              value={form.key}
              placeholder="??????"
              onChange={(event) => setForm((c) => ({ ...c, key: event.target.value }))}
            />
          </AdminField>
          <AdminField label="???">
            <input
              value={form.value}
              placeholder="??????"
              onChange={(event) => setForm((c) => ({ ...c, value: event.target.value }))}
            />
          </AdminField>
          <AdminField label="??">
            <input
              value={form.desc}
              placeholder="?????"
              onChange={(event) => setForm((c) => ({ ...c, desc: event.target.value }))}
            />
          </AdminField>
        </div>
      </AdminDialog>

      <AdminConfirmDialog
        open={Boolean(deleteTarget)}
        title="????"
        message="?????????"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            setRows((current) => current.filter((row) => row.id !== deleteTarget.id));
            showSuccess('????');
          }
          setDeleteTarget(null);
        }}
      />
      {ToastHost}
    </AdminPage>
  );
}
