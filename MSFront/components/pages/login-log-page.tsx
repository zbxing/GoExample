'use client';

import { useMemo, useState } from 'react';
import {
  AdminCard,
  AdminConfirmDialog,
  AdminField,
  AdminLinkButton,
  AdminPage,
  AdminPagination,
  AdminSearchForm,
  AdminSelect,
  AdminTable,
  AdminToolbar,
  useAdminToast,
} from '@/components/admin/admin-primitives';

type LoginLogRow = {
  id: string;
  username: string;
  ip: string;
  status: boolean;
  detail: string;
  agent: string;
  createdAt: string;
};

const INITIAL: LoginLogRow[] = [
  {
    id: '1',
    username: 'admin',
    ip: '127.0.0.1',
    status: true,
    detail: '????',
    agent: 'Chrome / Windows',
    createdAt: '2026-09-01 09:12:33',
  },
  {
    id: '2',
    username: 'demo',
    ip: '10.0.0.18',
    status: false,
    detail: '????',
    agent: 'Edge / Windows',
    createdAt: '2026-09-01 08:41:02',
  },
  {
    id: '3',
    username: 'ops',
    ip: '192.168.1.22',
    status: true,
    detail: '????',
    agent: 'Safari / macOS',
    createdAt: '2026-08-31 22:05:11',
  },
];

export function LoginLogPage() {
  const { showSuccess, ToastHost } = useAdminToast();
  const [rows, setRows] = useState(INITIAL);
  const [draft, setDraft] = useState({ username: '', status: '' });
  const [applied, setApplied] = useState({ username: '', status: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<LoginLogRow | null>(null);
  const [batchDelete, setBatchDelete] = useState(false);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (applied.username && !row.username.includes(applied.username)) return false;
      if (applied.status === 'true' && !row.status) return false;
      if (applied.status === 'false' && row.status) return false;
      return true;
    });
  }, [applied, rows]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  function removeIds(ids: string[]) {
    setRows((current) => current.filter((row) => !ids.includes(row.id)));
    setSelectedIds([]);
    showSuccess('????');
  }

  return (
    <AdminPage>
      <AdminSearchForm
        onSearch={() => {
          setPage(1);
          setApplied(draft);
        }}
        onReset={() => {
          setDraft({ username: '', status: '' });
          setApplied({ username: '', status: '' });
          setPage(1);
        }}
      >
        <AdminField label="???">
          <input
            value={draft.username}
            placeholder="?????"
            onChange={(event) => setDraft((c) => ({ ...c, username: event.target.value }))}
          />
        </AdminField>
        <AdminField label="??">
          <AdminSelect
            value={draft.status}
            placeholder="???"
            options={[
              { value: '', label: '??' },
              { value: 'true', label: '??' },
              { value: 'false', label: '??' },
            ]}
            onChange={(value) => setDraft((c) => ({ ...c, status: value }))}
          />
        </AdminField>
      </AdminSearchForm>

      <AdminCard>
        <AdminToolbar>
          <button
            type="button"
            className="elButton"
            disabled={!selectedIds.length}
            onClick={() => setBatchDelete(true)}
          >
            ??
          </button>
        </AdminToolbar>

        <AdminTable
          selectable
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          columns={[
            { key: 'id', title: 'ID', width: 80 },
            { key: 'username', title: '???', width: 140 },
            { key: 'ip', title: '??IP', width: 140 },
            {
              key: 'status',
              title: '??',
              width: 100,
              render: (row) => (
                <span className={row.status ? 'fnaTag success' : 'fnaTag danger'}>
                  {row.status ? '??' : '??'}
                </span>
              ),
            },
            { key: 'detail', title: '??' },
            { key: 'agent', title: '???/??' },
            { key: 'createdAt', title: '????', width: 180 },
            {
              key: 'actions',
              title: '??',
              width: 100,
              render: (row) => (
                <AdminLinkButton
                  icon="delete"
                  onClick={() => setDeleteTarget(row as unknown as LoginLogRow)}
                >
                  ??
                </AdminLinkButton>
              ),
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

      <AdminConfirmDialog
        open={Boolean(deleteTarget)}
        title="????"
        message="????????????"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) removeIds([deleteTarget.id]);
          setDeleteTarget(null);
        }}
      />
      <AdminConfirmDialog
        open={batchDelete}
        title="????"
        message={`??????? ${selectedIds.length} ?????`}
        onCancel={() => setBatchDelete(false)}
        onConfirm={() => {
          removeIds(selectedIds);
          setBatchDelete(false);
        }}
      />
      {ToastHost}
    </AdminPage>
  );
}
