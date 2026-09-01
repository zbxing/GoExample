'use client';

import { useMemo, useState } from 'react';
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

type OperationRow = {
  id: string;
  userName: string;
  nickName: string;
  createdAt: string;
  status: number;
  ip: string;
  requestId: string;
  traceId: string;
  method: string;
  path: string;
  body: string;
  resp: string;
};

const INITIAL: OperationRow[] = [
  {
    id: '1',
    userName: 'admin',
    nickName: '?????',
    createdAt: '2026-09-01 10:21:08',
    status: 200,
    ip: '127.0.0.1',
    requestId: 'req-8f2a1c',
    traceId: 'trc-91ab',
    method: 'GET',
    path: '/api/system/users',
    body: '',
    resp: '{"code":0,"data":{"users":[]}}',
  },
  {
    id: '2',
    userName: 'admin',
    nickName: '?????',
    createdAt: '2026-09-01 10:18:44',
    status: 200,
    ip: '127.0.0.1',
    requestId: 'req-22bc0e',
    traceId: 'trc-44cd',
    method: 'PUT',
    path: '/api/system/menus',
    body: '{"id":"menu-1","name":"???"}',
    resp: '{"code":0,"msg":"ok"}',
  },
  {
    id: '3',
    userName: 'demo',
    nickName: '????',
    createdAt: '2026-08-31 19:02:11',
    status: 403,
    ip: '10.0.0.8',
    requestId: 'req-77aa',
    traceId: 'trc-11ef',
    method: 'DELETE',
    path: '/api/system/roles',
    body: '{"id":"role-2"}',
    resp: '{"code":7,"msg":"forbidden"}',
  },
];

export function OperationLogPage() {
  const { showSuccess, ToastHost } = useAdminToast();
  const [rows, setRows] = useState(INITIAL);
  const [draft, setDraft] = useState({ method: '', path: '', status: '' });
  const [applied, setApplied] = useState({ method: '', path: '', status: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detail, setDetail] = useState<{ title: string; content: string } | null>(null);
  const [batchDelete, setBatchDelete] = useState(false);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (applied.method && !row.method.toLowerCase().includes(applied.method.toLowerCase())) {
        return false;
      }
      if (applied.path && !row.path.includes(applied.path)) return false;
      if (applied.status && String(row.status) !== applied.status) return false;
      return true;
    });
  }, [applied, rows]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  return (
    <AdminPage>
      <AdminSearchForm
        onSearch={() => {
          setPage(1);
          setApplied(draft);
        }}
        onReset={() => {
          setDraft({ method: '', path: '', status: '' });
          setApplied({ method: '', path: '', status: '' });
          setPage(1);
        }}
      >
        <AdminField label="????">
          <input
            value={draft.method}
            placeholder="????"
            onChange={(event) => setDraft((c) => ({ ...c, method: event.target.value }))}
          />
        </AdminField>
        <AdminField label="????">
          <input
            value={draft.path}
            placeholder="????"
            onChange={(event) => setDraft((c) => ({ ...c, path: event.target.value }))}
          />
        </AdminField>
        <AdminField label="?????">
          <input
            value={draft.status}
            placeholder="????"
            onChange={(event) => setDraft((c) => ({ ...c, status: event.target.value }))}
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
            {
              key: 'operator',
              title: '???',
              width: 160,
              render: (row) => `${row.userName}(${row.nickName})`,
            },
            { key: 'createdAt', title: '??', width: 170 },
            {
              key: 'status',
              title: '???',
              width: 100,
              render: (row) => <span className="fnaTag success">{String(row.status)}</span>,
            },
            { key: 'ip', title: '??IP', width: 120 },
            { key: 'requestId', title: '??ID', width: 140 },
            { key: 'traceId', title: '??ID', width: 120 },
            { key: 'method', title: '????', width: 100 },
            { key: 'path', title: '????', minWidth: 180 },
            {
              key: 'body',
              title: '??',
              width: 80,
              render: (row) =>
                row.body ? (
                  <AdminLinkButton
                    onClick={() => setDetail({ title: '???', content: String(row.body) })}
                  >
                    ??
                  </AdminLinkButton>
                ) : (
                  '?'
                ),
            },
            {
              key: 'resp',
              title: '??',
              width: 80,
              render: (row) => (
                <AdminLinkButton
                  onClick={() => setDetail({ title: '???', content: String(row.resp) })}
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

      <AdminDialog
        open={Boolean(detail)}
        title={detail?.title || ''}
        onClose={() => setDetail(null)}
        cancelLabel="??"
        variant="dialog"
        width={520}
      >
        <pre className="fnaCodeBlock">{detail?.content}</pre>
      </AdminDialog>

      <AdminConfirmDialog
        open={batchDelete}
        title="????"
        message={`??????? ${selectedIds.length} ???????`}
        onCancel={() => setBatchDelete(false)}
        onConfirm={() => {
          setRows((current) => current.filter((row) => !selectedIds.includes(row.id)));
          setSelectedIds([]);
          setBatchDelete(false);
          showSuccess('????');
        }}
      />
      {ToastHost}
    </AdminPage>
  );
}
