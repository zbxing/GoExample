'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AdminCard,
  AdminLinkButton,
  AdminPage,
  AdminTable,
  AdminToolbar,
  useAdminToast,
} from '@/components/admin/admin-primitives';

type ChunkTask = {
  id: string;
  name: string;
  sizeLabel: string;
  progress: number;
  speed: string;
  status: 'uploading' | 'paused' | 'done' | 'error';
};

export function ChunkUploadPage() {
  const { showSuccess, ToastHost } = useAdminToast();
  const [dragging, setDragging] = useState(false);
  const [tasks, setTasks] = useState<ChunkTask[]>([
    {
      id: '1',
      name: 'demo-video.mp4',
      sizeLabel: '256 MB',
      progress: 62,
      speed: '4.2 MB/s',
      status: 'uploading',
    },
  ]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTasks((current) =>
        current.map((task) => {
          if (task.status !== 'uploading') return task;
          const next = Math.min(100, task.progress + Math.random() * 8);
          return {
            ...task,
            progress: Number(next.toFixed(0)),
            speed: next >= 100 ? '—' : `${(3 + Math.random() * 3).toFixed(1)} MB/s`,
            status: next >= 100 ? 'done' : 'uploading',
          };
        }),
      );
    }, 1200);
    return () => window.clearInterval(timer);
  }, []);

  function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const next = Array.from(files).map((file, index) => ({
      id: `${Date.now()}-${index}`,
      name: file.name,
      sizeLabel:
        file.size > 1024 * 1024
          ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
          : `${Math.max(1, Math.round(file.size / 1024))} KB`,
      progress: 0,
      speed: '等待中',
      status: 'uploading' as const,
    }));
    setTasks((current) => [...next, ...current]);
    showSuccess(`已添加 ${next.length} 个上传任务（本地演示）`);
  }

  return (
    <AdminPage>
      <div
        className={`fnaChunkDropzone${dragging ? ' is-dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          addFiles(event.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            inputRef.current?.click();
          }
        }}
      >
        <strong>拖拽文件到此处，或点击选择</strong>
        <span>大文件分片上传演示：仅模拟进度，不会上传到服务器</span>
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
      </div>

      <AdminCard>
        <AdminToolbar>
          <button type="button" className="elButton" onClick={() => inputRef.current?.click()}>
            添加文件
          </button>
        </AdminToolbar>
        <AdminTable
          columns={[
            { key: 'name', title: '文件名', minWidth: 180 },
            { key: 'sizeLabel', title: '大小', width: 100 },
            {
              key: 'progress',
              title: '进度',
              minWidth: 180,
              render: (row) => (
                <div>
                  <div className="fnaProgressTrack">
                    <div className="fnaProgressBar" style={{ width: `${Number(row.progress)}%` }} />
                  </div>
                  <span>{String(row.progress)}%</span>
                </div>
              ),
            },
            { key: 'speed', title: '速度', width: 110 },
            {
              key: 'status',
              title: '状态',
              width: 100,
              render: (row) => {
                const map: Record<string, string> = {
                  uploading: '上传中',
                  paused: '已暂停',
                  done: '已完成',
                  error: '失败',
                };
                return map[String(row.status)] || String(row.status);
              },
            },
            {
              key: 'actions',
              title: '操作',
              width: 180,
              render: (row) => {
                const item = row as unknown as ChunkTask;
                return (
                  <div className="fnaRowActions">
                    {item.status === 'uploading' ? (
                      <AdminLinkButton
                        onClick={() =>
                          setTasks((current) =>
                            current.map((task) =>
                              task.id === item.id
                                ? { ...task, status: 'paused', speed: '—' }
                                : task,
                            ),
                          )
                        }
                      >
                        暂停
                      </AdminLinkButton>
                    ) : null}
                    {item.status === 'paused' ? (
                      <AdminLinkButton
                        onClick={() =>
                          setTasks((current) =>
                            current.map((task) =>
                              task.id === item.id
                                ? { ...task, status: 'uploading', speed: '恢复中' }
                                : task,
                            ),
                          )
                        }
                      >
                        继续
                      </AdminLinkButton>
                    ) : null}
                    <AdminLinkButton
                      icon="delete"
                      onClick={() =>
                        setTasks((current) => current.filter((task) => task.id !== item.id))
                      }
                    >
                      移除
                    </AdminLinkButton>
                  </div>
                );
              },
            },
          ]}
          rows={tasks as unknown as Array<Record<string, unknown>>}
        />
      </AdminCard>
      {ToastHost}
    </AdminPage>
  );
}
