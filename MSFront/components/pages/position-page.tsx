'use client';

import { useMemo, useState } from 'react';
import { IconPlus } from '@/components/admin/admin-icons';
import {
  AdminDialog,
  AdminField,
  AdminLinkButton,
  AdminPage,
  AdminTable,
  AdminToolbar,
  useAdminToast,
} from '@/components/admin/admin-primitives';

type Position = { id: string; name: string; code: string; remark: string };
type Member = { id: string; username: string; displayName: string; positionId: string };

const INITIAL_POSITIONS: Position[] = [
  { id: 'p1', name: '工程师', code: 'eng', remark: '研发岗衔' },
  { id: 'p2', name: '产品经理', code: 'pm', remark: '产品岗' },
  { id: 'p3', name: '设计师', code: 'design', remark: '体验设计' },
];

const INITIAL_MEMBERS: Member[] = [
  { id: 'u1', username: 'alice', displayName: 'Alice', positionId: 'p1' },
  { id: 'u2', username: 'bob', displayName: 'Bob', positionId: 'p1' },
  { id: 'u3', username: 'carol', displayName: 'Carol', positionId: 'p2' },
];

export function PositionPage() {
  const { showSuccess, showError, ToastHost } = useAdminToast();
  const [positions, setPositions] = useState(INITIAL_POSITIONS);
  const [members, setMembers] = useState(INITIAL_MEMBERS);
  const [keyword, setKeyword] = useState('');
  const [activeId, setActiveId] = useState('p1');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ id: '', name: '', code: '', remark: '' });

  const filtered = useMemo(() => {
    if (!keyword.trim()) return positions;
    return positions.filter(
      (item) => item.name.includes(keyword) || item.code.includes(keyword),
    );
  }, [keyword, positions]);

  const active = positions.find((item) => item.id === activeId);
  const activeMembers = members.filter((member) => member.positionId === activeId);

  function save() {
    if (!form.name.trim() || !form.code.trim()) {
      showError('请填写岗位名称与编码');
      return;
    }
    if (form.id) {
      setPositions((current) =>
        current.map((item) =>
          item.id === form.id
            ? { ...item, name: form.name, code: form.code, remark: form.remark }
            : item,
        ),
      );
      showSuccess('岗位已更新');
    } else {
      const id = `p${Date.now()}`;
      setPositions((current) => [
        ...current,
        { id, name: form.name, code: form.code, remark: form.remark },
      ]);
      setActiveId(id);
      showSuccess('岗位已创建');
    }
    setOpen(false);
  }

  return (
    <AdminPage>
      <div className="fnaDemoSplit">
        <aside className="fnaDemoSplitPane">
          <h3>岗位列表</h3>
          <AdminToolbar>
            <input
              value={keyword}
              placeholder="搜索岗位"
              onChange={(event) => setKeyword(event.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button
              type="button"
              className="elButton elButtonPrimary"
              onClick={() => {
                setForm({ id: '', name: '', code: '', remark: '' });
                setOpen(true);
              }}
            >
              <span className="elButtonIcon" aria-hidden="true">
                <IconPlus size={14} />
              </span>
              新增
            </button>
          </AdminToolbar>
          <ul className="fnaDemoList">
            {filtered.map((item) => (
              <li key={item.id} className="fnaDemoListRow">
                <button
                  type="button"
                  className={item.id === activeId ? 'is-active' : undefined}
                  onClick={() => setActiveId(item.id)}
                >
                  <span>
                    {item.name}
                    <small style={{ marginLeft: 8, opacity: 0.7 }}>{item.code}</small>
                  </span>
                </button>
                <AdminLinkButton
                  icon="edit"
                  onClick={() => {
                    setForm({
                      id: item.id,
                      name: item.name,
                      code: item.code,
                      remark: item.remark,
                    });
                    setOpen(true);
                  }}
                >
                  编辑
                </AdminLinkButton>
              </li>
            ))}
          </ul>
        </aside>

        <section className="fnaDemoSplitPane">
          <h3>成员分配 · {active?.name || '—'}</h3>
          <p style={{ marginTop: 0, color: 'var(--el-text-color-secondary)' }}>
            {active?.remark || '暂无备注'}
          </p>
          <AdminTable
            columns={[
              { key: 'username', title: '用户名', width: 140 },
              { key: 'displayName', title: '昵称', width: 140 },
              {
                key: 'actions',
                title: '操作',
                width: 120,
                render: (row) => (
                  <AdminLinkButton
                    icon="delete"
                    onClick={() =>
                      setMembers((current) => current.filter((item) => item.id !== row.id))
                    }
                  >
                    移除
                  </AdminLinkButton>
                ),
              },
            ]}
            rows={activeMembers as unknown as Array<Record<string, unknown>>}
            emptyText="该岗位暂无成员"
          />
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className="elButton"
              onClick={() => {
                setMembers((current) => [
                  ...current,
                  {
                    id: `u${Date.now()}`,
                    username: `user${current.length + 1}`,
                    displayName: `成员${current.length + 1}`,
                    positionId: activeId,
                  },
                ]);
                showSuccess('已加入演示成员');
              }}
            >
              添加成员
            </button>
          </div>
        </section>
      </div>

      <AdminDialog
        open={open}
        title={form.id ? '编辑岗位' : '新增岗位'}
        onClose={() => setOpen(false)}
        onConfirm={save}
        width={480}
      >
        <div className="adminForm fnaDialogForm">
          <AdminField label="名称">
            <input
              value={form.name}
              onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
            />
          </AdminField>
          <AdminField label="编码">
            <input
              value={form.code}
              onChange={(event) => setForm((c) => ({ ...c, code: event.target.value }))}
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
      {ToastHost}
    </AdminPage>
  );
}
