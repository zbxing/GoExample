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
  AdminSelect,
  AdminTable,
  AdminToolbar,
  useAdminToast,
} from '@/components/admin/admin-primitives';

type TokenRow = {
  id: string;
  userLabel: string;
  authorityId: string;
  status: boolean;
  expiresAt: string;
  remark: string;
  token: string;
};

const INITIAL: TokenRow[] = [
  {
    id: '1',
    userLabel: '????? (admin)',
    authorityId: '888',
    status: true,
    expiresAt: '2026-12-31 23:59:59',
    remark: 'CI ???',
    token: 'fna_demo_token_alpha',
  },
  {
    id: '2',
    userLabel: '???? (demo)',
    authorityId: '9528',
    status: false,
    expiresAt: '2026-06-01 00:00:00',
    remark: '?????',
    token: 'fna_demo_token_beta',
  },
];

export function ApiTokenPage() {
  const { showSuccess, showError, ToastHost } = useAdminToast();
  const [rows, setRows] = useState(INITIAL);
  const [draft, setDraft] = useState({ userId: '', status: '' });
  const [applied, setApplied] = useState({ userId: '', status: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [open, setOpen] = useState(false);
  const [curlOpen, setCurlOpen] = useState(false);
  const [curlText, setCurlText] = useState('');
  const [form, setForm] = useState({ user: 'admin', authorityId: '888', remark: '', days: '30' });
  const [invalidateTarget, setInvalidateTarget] = useState<TokenRow | null>(null);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (applied.userId && !row.userLabel.includes(applied.userId)) return false;
      if (applied.status === 'true' && !row.status) return false;
      if (applied.status === 'false' && row.status) return false;
      return true;
    });
  }, [applied, rows]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  function issueToken() {
    if (!form.user.trim()) {
      showError('?????');
      return;
    }
    const expires = new Date();
    expires.setDate(expires.getDate() + Number(form.days || 30));
    const token = `fna_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
    setRows((current) => [
      {
        id: String(Date.now()),
        userLabel: form.user === 'admin' ? '????? (admin)' : '???? (demo)',
        authorityId: form.authorityId,
        status: true,
        expiresAt: expires.toISOString().slice(0, 19).replace('T', ' '),
        remark: form.remark || '?',
        token,
      },
      ...current,
    ]);
    setOpen(false);
    setCurlText(`curl -H "x-token: ${token}" http://localhost:3000/api/system/users`);
    setCurlOpen(true);
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
          setDraft({ userId: '', status: '' });
          setApplied({ userId: '', status: '' });
          setPage(1);
        }}
      >
        <AdminField label="??">
          <input
            value={draft.userId}
            placeholder="????"
            onChange={(event) => setDraft((c) => ({ ...c, userId: event.target.value }))}
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
          <button type="button" className="elButton elButtonPrimary" onClick={() => setOpen(true)}>
            <span className="elButtonIcon" aria-hidden="true">
              <IconPlus size={14} />
            </span>
            ??
          </button>
        </AdminToolbar>

        <AdminTable
          columns={[
            { key: 'id', title: 'ID', width: 80 },
            { key: 'userLabel', title: '??', minWidth: 160 },
            { key: 'authorityId', title: '??ID', width: 100 },
            {
              key: 'status',
              title: '??',
              width: 100,
              render: (row) => (
                <span className={row.status ? 'fnaTag success' : 'fnaTag danger'}>
                  {row.status ? '??' : '???'}
                </span>
              ),
            },
            { key: 'expiresAt', title: '????', width: 180 },
            { key: 'remark', title: '??', minWidth: 140 },
            {
              key: 'actions',
              title: '??',
              width: 200,
              render: (row) => {
                const item = row as unknown as TokenRow;
                return (
                  <div className="fnaRowActions">
                    <AdminLinkButton
                      onClick={() => {
                        setCurlText(
                          `curl -H "x-token: ${item.token}" http://localhost:3000/api/system/users`,
                        );
                        setCurlOpen(true);
                      }}
                    >
                      Curl??
                    </AdminLinkButton>
                    {item.status ? (
                      <AdminLinkButton icon="delete" onClick={() => setInvalidateTarget(item)}>
                        ??
                      </AdminLinkButton>
                    ) : null}
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
        title="?? API Token"
        onClose={() => setOpen(false)}
        onConfirm={issueToken}
        confirmLabel="??"
        width={480}
      >
        <div className="adminForm fnaDialogForm">
          <AdminField label="??">
            <AdminSelect
              value={form.user}
              options={[
                { value: 'admin', label: '????? (admin)' },
                { value: 'demo', label: '???? (demo)' },
              ]}
              onChange={(value) => setForm((c) => ({ ...c, user: value }))}
            />
          </AdminField>
          <AdminField label="??ID">
            <input
              value={form.authorityId}
              onChange={(event) => setForm((c) => ({ ...c, authorityId: event.target.value }))}
            />
          </AdminField>
          <AdminField label="????">
            <input
              value={form.days}
              onChange={(event) => setForm((c) => ({ ...c, days: event.target.value }))}
            />
          </AdminField>
          <AdminField label="??">
            <input
              value={form.remark}
              placeholder="??"
              onChange={(event) => setForm((c) => ({ ...c, remark: event.target.value }))}
            />
          </AdminField>
        </div>
      </AdminDialog>

      <AdminDialog
        open={curlOpen}
        title="Curl ??"
        onClose={() => setCurlOpen(false)}
        onConfirm={() => {
          void navigator.clipboard.writeText(curlText).then(
            () => showSuccess('???'),
            () => showError('????'),
          );
        }}
        confirmLabel="??"
        variant="dialog"
        width={560}
      >
        <pre className="fnaCodeBlock">{curlText}</pre>
      </AdminDialog>

      <AdminConfirmDialog
        open={Boolean(invalidateTarget)}
        title="?? Token"
        message="?????? Token ??"
        onCancel={() => setInvalidateTarget(null)}
        onConfirm={() => {
          if (invalidateTarget) {
            setRows((current) =>
              current.map((row) =>
                row.id === invalidateTarget.id ? { ...row, status: false } : row,
              ),
            );
            showSuccess('???');
          }
          setInvalidateTarget(null);
        }}
      />
      {ToastHost}
    </AdminPage>
  );
}
