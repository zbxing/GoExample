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

type Dept = { id: string; name: string; parentId: string | null; sort: number };
type Member = { id: string; username: string; displayName: string; deptId: string };

const INITIAL_DEPTS: Dept[] = [
  { id: 'd1', name: '总部', parentId: null, sort: 1 },
  { id: 'd2', name: '研发中心', parentId: 'd1', sort: 1 },
  { id: 'd3', name: '产品中心', parentId: 'd1', sort: 2 },
  { id: 'd4', name: '前端组', parentId: 'd2', sort: 1 },
  { id: 'd5', name: '后端组', parentId: 'd2', sort: 2 },
];

const INITIAL_MEMBERS: Member[] = [
  { id: 'u1', username: 'admin', displayName: '超级管理员', deptId: 'd1' },
  { id: 'u2', username: 'alice', displayName: 'Alice', deptId: 'd4' },
  { id: 'u3', username: 'bob', displayName: 'Bob', deptId: 'd5' },
  { id: 'u4', username: 'carol', displayName: 'Carol', deptId: 'd3' },
];

export function DepartmentPage() {
  const { showSuccess, showError, ToastHost } = useAdminToast();
  const [depts, setDepts] = useState(INITIAL_DEPTS);
  const [members, setMembers] = useState(INITIAL_MEMBERS);
  const [activeId, setActiveId] = useState('d1');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ id: '', name: '', parentId: '', sort: '1' });

  const treeRows = useMemo(() => {
    const byParent = new Map<string | null, Dept[]>();
    for (const dept of depts) {
      const key = dept.parentId;
      const list = byParent.get(key) ?? [];
      list.push(dept);
      byParent.set(key, list);
    }
    const out: Array<Dept & { depth: number }> = [];
    function walk(parentId: string | null, depth: number) {
      const children = (byParent.get(parentId) ?? []).slice().sort((a, b) => a.sort - b.sort);
      for (const child of children) {
        out.push({ ...child, depth });
        walk(child.id, depth + 1);
      }
    }
    walk(null, 0);
    return out;
  }, [depts]);

  const activeMembers = members.filter((member) => member.deptId === activeId);
  const activeDept = depts.find((dept) => dept.id === activeId);

  function saveDept() {
    if (!form.name.trim()) {
      showError('请输入部门名称');
      return;
    }
    if (form.id) {
      setDepts((current) =>
        current.map((dept) =>
          dept.id === form.id
            ? {
                ...dept,
                name: form.name,
                parentId: form.parentId || null,
                sort: Number(form.sort) || 1,
              }
            : dept,
        ),
      );
      showSuccess('部门已更新');
    } else {
      const id = `d${Date.now()}`;
      setDepts((current) => [
        ...current,
        {
          id,
          name: form.name,
          parentId: form.parentId || null,
          sort: Number(form.sort) || 1,
        },
      ]);
      setActiveId(id);
      showSuccess('部门已创建');
    }
    setOpen(false);
  }

  return (
    <AdminPage>
      <div className="fnaDemoSplit">
        <aside className="fnaDemoSplitPane">
          <h3>部门树</h3>
          <AdminToolbar>
            <button
              type="button"
              className="elButton elButtonPrimary"
              onClick={() => {
                setForm({ id: '', name: '', parentId: activeId, sort: '1' });
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
            {treeRows.map((dept) => (
              <li key={dept.id} className="fnaDemoListRow">
                <button
                  type="button"
                  className={dept.id === activeId ? 'is-active' : undefined}
                  style={{ paddingLeft: 10 + dept.depth * 14 }}
                  onClick={() => setActiveId(dept.id)}
                >
                  <span>{dept.name}</span>
                </button>
                <AdminLinkButton
                  icon="edit"
                  onClick={() => {
                    setForm({
                      id: dept.id,
                      name: dept.name,
                      parentId: dept.parentId ?? '',
                      sort: String(dept.sort),
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
          <h3>成员分配 · {activeDept?.name || '—'}</h3>
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
            emptyText="该部门暂无成员"
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
                    deptId: activeId,
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
        title={form.id ? '编辑部门' : '新增部门'}
        onClose={() => setOpen(false)}
        onConfirm={saveDept}
        width={480}
      >
        <div className="adminForm fnaDialogForm">
          <AdminField label="名称">
            <input
              value={form.name}
              onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
            />
          </AdminField>
          <AdminField label="上级部门">
            <select
              value={form.parentId}
              onChange={(event) => setForm((c) => ({ ...c, parentId: event.target.value }))}
            >
              <option value="">无（顶级）</option>
              {depts
                .filter((dept) => dept.id !== form.id)
                .map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
            </select>
          </AdminField>
          <AdminField label="排序">
            <input
              value={form.sort}
              onChange={(event) => setForm((c) => ({ ...c, sort: event.target.value }))}
            />
          </AdminField>
        </div>
      </AdminDialog>
      {ToastHost}
    </AdminPage>
  );
}
