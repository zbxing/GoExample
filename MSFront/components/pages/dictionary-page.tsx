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

type Dict = { id: string; name: string; type: string; status: boolean; desc: string };
type Detail = {
  id: string;
  dictId: string;
  label: string;
  value: string;
  sort: number;
  status: boolean;
};

const INITIAL_DICTS: Dict[] = [
  { id: '1', name: '性别', type: 'gender', status: true, desc: '用户性别' },
  { id: '2', name: '状态', type: 'sys_status', status: true, desc: '通用启用禁用' },
  { id: '3', name: '通知类型', type: 'notice_type', status: true, desc: '公告分类' },
];

const INITIAL_DETAILS: Detail[] = [
  { id: 'd1', dictId: '1', label: '男', value: '1', sort: 1, status: true },
  { id: 'd2', dictId: '1', label: '女', value: '2', sort: 2, status: true },
  { id: 'd3', dictId: '2', label: '启用', value: 'true', sort: 1, status: true },
  { id: 'd4', dictId: '2', label: '禁用', value: 'false', sort: 2, status: true },
  { id: 'd5', dictId: '3', label: '公告', value: 'notice', sort: 1, status: true },
];

export function DictionaryPage() {
  const { showSuccess, showError, ToastHost } = useAdminToast();
  const [dicts, setDicts] = useState(INITIAL_DICTS);
  const [details, setDetails] = useState(INITIAL_DETAILS);
  const [keyword, setKeyword] = useState('');
  const [activeId, setActiveId] = useState('1');
  const [dictOpen, setDictOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [dictForm, setDictForm] = useState({ id: '', name: '', type: '', desc: '' });
  const [detailForm, setDetailForm] = useState({
    id: '',
    label: '',
    value: '',
    sort: '1',
  });

  const filteredDicts = useMemo(() => {
    if (!keyword.trim()) return dicts;
    return dicts.filter(
      (item) => item.name.includes(keyword) || item.type.includes(keyword),
    );
  }, [dicts, keyword]);

  const activeDetails = details
    .filter((item) => item.dictId === activeId)
    .slice()
    .sort((a, b) => a.sort - b.sort);
  const activeDict = dicts.find((item) => item.id === activeId);

  function saveDict() {
    if (!dictForm.name.trim() || !dictForm.type.trim()) {
      showError('请填写字典名与类型');
      return;
    }
    if (dictForm.id) {
      setDicts((current) =>
        current.map((item) =>
          item.id === dictForm.id
            ? { ...item, name: dictForm.name, type: dictForm.type, desc: dictForm.desc }
            : item,
        ),
      );
      showSuccess('字典已更新');
    } else {
      const id = String(Date.now());
      setDicts((current) => [
        ...current,
        {
          id,
          name: dictForm.name,
          type: dictForm.type,
          desc: dictForm.desc,
          status: true,
        },
      ]);
      setActiveId(id);
      showSuccess('字典已创建');
    }
    setDictOpen(false);
  }

  function saveDetail() {
    if (!detailForm.label.trim() || !detailForm.value.trim()) {
      showError('请填写展示值与字典值');
      return;
    }
    if (detailForm.id) {
      setDetails((current) =>
        current.map((item) =>
          item.id === detailForm.id
            ? {
                ...item,
                label: detailForm.label,
                value: detailForm.value,
                sort: Number(detailForm.sort) || 1,
              }
            : item,
        ),
      );
      showSuccess('明细已更新');
    } else {
      setDetails((current) => [
        ...current,
        {
          id: `d${Date.now()}`,
          dictId: activeId,
          label: detailForm.label,
          value: detailForm.value,
          sort: Number(detailForm.sort) || 1,
          status: true,
        },
      ]);
      showSuccess('明细已创建');
    }
    setDetailOpen(false);
  }

  return (
    <AdminPage>
      <div className="fnaDemoSplit">
        <aside className="fnaDemoSplitPane">
          <h3>字典列表</h3>
          <AdminToolbar>
            <input
              value={keyword}
              placeholder="搜索字典"
              onChange={(event) => setKeyword(event.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button
              type="button"
              className="elButton elButtonPrimary"
              onClick={() => {
                setDictForm({ id: '', name: '', type: '', desc: '' });
                setDictOpen(true);
              }}
            >
              <span className="elButtonIcon" aria-hidden="true">
                <IconPlus size={14} />
              </span>
              新增
            </button>
          </AdminToolbar>
          <ul className="fnaDemoList">
            {filteredDicts.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={item.id === activeId ? 'is-active' : undefined}
                  onClick={() => setActiveId(item.id)}
                >
                  <span>
                    {item.name}
                    <small style={{ marginLeft: 8, opacity: 0.7 }}>{item.type}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="fnaDemoSplitPane">
          <h3>字典详情 · {activeDict?.name || '—'}</h3>
          <AdminToolbar>
            <button
              type="button"
              className="elButton elButtonPrimary"
              onClick={() => {
                setDetailForm({ id: '', label: '', value: '', sort: '1' });
                setDetailOpen(true);
              }}
            >
              <span className="elButtonIcon" aria-hidden="true">
                <IconPlus size={14} />
              </span>
              新增明细
            </button>
            <button
              type="button"
              className="elButton"
              onClick={() => {
                if (!activeDict) return;
                setDictForm({
                  id: activeDict.id,
                  name: activeDict.name,
                  type: activeDict.type,
                  desc: activeDict.desc,
                });
                setDictOpen(true);
              }}
            >
              编辑字典
            </button>
          </AdminToolbar>
          <AdminTable
            columns={[
              { key: 'label', title: '展示值', width: 140 },
              { key: 'value', title: '字典值', width: 140 },
              { key: 'sort', title: '排序', width: 80 },
              {
                key: 'status',
                title: '状态',
                width: 90,
                render: (row) => (
                  <span className={row.status ? 'fnaTag success' : 'fnaTag danger'}>
                    {row.status ? '启用' : '禁用'}
                  </span>
                ),
              },
              {
                key: 'actions',
                title: '操作',
                width: 160,
                render: (row) => {
                  const item = row as unknown as Detail;
                  return (
                    <div className="fnaRowActions">
                      <AdminLinkButton
                        icon="edit"
                        onClick={() => {
                          setDetailForm({
                            id: item.id,
                            label: item.label,
                            value: item.value,
                            sort: String(item.sort),
                          });
                          setDetailOpen(true);
                        }}
                      >
                        编辑
                      </AdminLinkButton>
                      <AdminLinkButton
                        icon="delete"
                        onClick={() =>
                          setDetails((current) => current.filter((entry) => entry.id !== item.id))
                        }
                      >
                        删除
                      </AdminLinkButton>
                    </div>
                  );
                },
              },
            ]}
            rows={activeDetails as unknown as Array<Record<string, unknown>>}
          />
        </section>
      </div>

      <AdminDialog
        open={dictOpen}
        title={dictForm.id ? '编辑字典' : '新增字典'}
        onClose={() => setDictOpen(false)}
        onConfirm={saveDict}
        width={480}
      >
        <div className="adminForm fnaDialogForm">
          <AdminField label="字典名">
            <input
              value={dictForm.name}
              onChange={(event) => setDictForm((c) => ({ ...c, name: event.target.value }))}
            />
          </AdminField>
          <AdminField label="字典类型">
            <input
              value={dictForm.type}
              onChange={(event) => setDictForm((c) => ({ ...c, type: event.target.value }))}
            />
          </AdminField>
          <AdminField label="描述">
            <input
              value={dictForm.desc}
              onChange={(event) => setDictForm((c) => ({ ...c, desc: event.target.value }))}
            />
          </AdminField>
        </div>
      </AdminDialog>

      <AdminDialog
        open={detailOpen}
        title={detailForm.id ? '编辑明细' : '新增明细'}
        onClose={() => setDetailOpen(false)}
        onConfirm={saveDetail}
        width={480}
      >
        <div className="adminForm fnaDialogForm">
          <AdminField label="展示值">
            <input
              value={detailForm.label}
              onChange={(event) => setDetailForm((c) => ({ ...c, label: event.target.value }))}
            />
          </AdminField>
          <AdminField label="字典值">
            <input
              value={detailForm.value}
              onChange={(event) => setDetailForm((c) => ({ ...c, value: event.target.value }))}
            />
          </AdminField>
          <AdminField label="排序">
            <input
              value={detailForm.sort}
              onChange={(event) => setDetailForm((c) => ({ ...c, sort: event.target.value }))}
            />
          </AdminField>
        </div>
      </AdminDialog>
      {ToastHost}
    </AdminPage>
  );
}
