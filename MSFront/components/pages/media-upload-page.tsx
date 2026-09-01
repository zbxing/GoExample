'use client';

import { useMemo, useRef, useState } from 'react';
import {
  AdminLinkButton,
  AdminPage,
  AdminTable,
  AdminToolbar,
  useAdminToast,
} from '@/components/admin/admin-primitives';

type Category = { id: string; name: string };
type MediaFile = {
  id: string;
  categoryId: string;
  name: string;
  sizeLabel: string;
  mime: string;
  updatedAt: string;
};

const CATEGORIES: Category[] = [
  { id: 'c1', name: '全部文件' },
  { id: 'c2', name: '图片' },
  { id: 'c3', name: '文档' },
  { id: 'c4', name: '视频' },
];

const INITIAL_FILES: MediaFile[] = [
  {
    id: 'f1',
    categoryId: 'c2',
    name: 'banner.png',
    sizeLabel: '320 KB',
    mime: 'image/png',
    updatedAt: '2026-08-28 11:20:00',
  },
  {
    id: 'f2',
    categoryId: 'c3',
    name: 'readme.pdf',
    sizeLabel: '1.2 MB',
    mime: 'application/pdf',
    updatedAt: '2026-08-29 09:10:00',
  },
  {
    id: 'f3',
    categoryId: 'c4',
    name: 'intro.mp4',
    sizeLabel: '18.6 MB',
    mime: 'video/mp4',
    updatedAt: '2026-08-30 16:40:00',
  },
];

export function MediaUploadPage() {
  const { showSuccess, ToastHost } = useAdminToast();
  const [categoryId, setCategoryId] = useState('c1');
  const [files, setFiles] = useState(INITIAL_FILES);
  const [keyword, setKeyword] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    return files.filter((file) => {
      if (categoryId !== 'c1' && file.categoryId !== categoryId) return false;
      if (keyword && !file.name.toLowerCase().includes(keyword.toLowerCase())) return false;
      return true;
    });
  }, [categoryId, files, keyword]);

  function addFiles(list: FileList | null) {
    if (!list?.length) return;
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const next = Array.from(list).map((file, index) => {
      const mime = file.type || 'application/octet-stream';
      let cat = 'c1';
      if (mime.startsWith('image/')) cat = 'c2';
      else if (mime.startsWith('video/')) cat = 'c4';
      else if (mime.includes('pdf') || mime.includes('text') || mime.includes('document')) cat = 'c3';
      return {
        id: `f${Date.now()}-${index}`,
        categoryId: cat,
        name: file.name,
        sizeLabel:
          file.size > 1024 * 1024
            ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
            : `${Math.max(1, Math.round(file.size / 1024))} KB`,
        mime,
        updatedAt: stamp,
      };
    });
    setFiles((current) => [...next, ...current]);
    showSuccess(`已添加 ${next.length} 个文件到媒体库（本地演示）`);
  }

  return (
    <AdminPage>
      <div className="fnaDemoSplit">
        <aside className="fnaDemoSplitPane">
          <h3>分类</h3>
          <ul className="fnaDemoList">
            {CATEGORIES.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={item.id === categoryId ? 'is-active' : undefined}
                  onClick={() => setCategoryId(item.id)}
                >
                  <span>{item.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="fnaDemoSplitPane">
          <h3>媒体库</h3>
          <AdminToolbar>
            <input
              value={keyword}
              placeholder="搜索文件名"
              onChange={(event) => setKeyword(event.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button
              type="button"
              className="elButton elButtonPrimary"
              onClick={() => inputRef.current?.click()}
            >
              上传文件
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                addFiles(event.target.files);
                event.target.value = '';
              }}
            />
          </AdminToolbar>
          <AdminTable
            columns={[
              { key: 'name', title: '文件名', minWidth: 180 },
              { key: 'mime', title: '类型', width: 140 },
              { key: 'sizeLabel', title: '大小', width: 100 },
              { key: 'updatedAt', title: '更新时间', width: 180 },
              {
                key: 'actions',
                title: '操作',
                width: 140,
                render: (row) => (
                  <div className="fnaRowActions">
                    <AdminLinkButton onClick={() => showSuccess(`预览 ${String(row.name)}（演示）`)}>
                      预览
                    </AdminLinkButton>
                    <AdminLinkButton
                      icon="delete"
                      onClick={() =>
                        setFiles((current) => current.filter((item) => item.id !== row.id))
                      }
                    >
                      删除
                    </AdminLinkButton>
                  </div>
                ),
              },
            ]}
            rows={visible as unknown as Array<Record<string, unknown>>}
          />
        </section>
      </div>
      {ToastHost}
    </AdminPage>
  );
}
