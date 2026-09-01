'use client';

import { useMemo, useState } from 'react';
import { IconPlus } from '@/components/admin/admin-icons';
import {
  AdminCard,
  AdminDialog,
  AdminField,
  AdminLinkButton,
  AdminPage,
  AdminTable,
  AdminToolbar,
  AdminWarningBar,
  useAdminToast,
} from '@/components/admin/admin-primitives';

type FormField = {
  id: string;
  label: string;
  name: string;
  type: 'input' | 'select' | 'switch' | 'textarea';
  required: boolean;
  placeholder: string;
};

const INITIAL: FormField[] = [
  {
    id: '1',
    label: '标题',
    name: 'title',
    type: 'input',
    required: true,
    placeholder: '请输入标题',
  },
  {
    id: '2',
    label: '类型',
    name: 'type',
    type: 'select',
    required: true,
    placeholder: '请选择类型',
  },
  {
    id: '3',
    label: '启用',
    name: 'enabled',
    type: 'switch',
    required: false,
    placeholder: '',
  },
  {
    id: '4',
    label: '备注',
    name: 'remark',
    type: 'textarea',
    required: false,
    placeholder: '可选备注',
  },
];

export function FormCreatePage() {
  const { showSuccess, showError, ToastHost } = useAdminToast();
  const [fields, setFields] = useState(INITIAL);
  const [open, setOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [form, setForm] = useState({
    id: '',
    label: '',
    name: '',
    type: 'input',
    required: true,
    placeholder: '',
  });
  const [previewValues, setPreviewValues] = useState<Record<string, string>>({});

  const exportJson = useMemo(
    () =>
      JSON.stringify(
        {
          form: 'demo-form',
          fields: fields.map(({ id: _id, ...rest }) => rest),
        },
        null,
        2,
      ),
    [fields],
  );

  function saveField() {
    if (!form.label.trim() || !form.name.trim()) {
      showError('请填写标签与字段名');
      return;
    }
    if (form.id) {
      setFields((current) =>
        current.map((item) =>
          item.id === form.id
            ? {
                ...item,
                label: form.label,
                name: form.name,
                type: form.type as FormField['type'],
                required: form.required,
                placeholder: form.placeholder,
              }
            : item,
        ),
      );
      showSuccess('字段已更新');
    } else {
      setFields((current) => [
        ...current,
        {
          id: String(Date.now()),
          label: form.label,
          name: form.name,
          type: form.type as FormField['type'],
          required: form.required,
          placeholder: form.placeholder,
        },
      ]);
      showSuccess('字段已添加');
    }
    setOpen(false);
  }

  return (
    <AdminPage>
      <AdminWarningBar title="表单生成器演示壳：提供字段清单与简易预览，未引入完整设计器依赖。" />
      <AdminCard>
        <AdminToolbar>
          <button
            type="button"
            className="elButton elButtonPrimary"
            onClick={() => {
              setForm({
                id: '',
                label: '',
                name: '',
                type: 'input',
                required: true,
                placeholder: '',
              });
              setOpen(true);
            }}
          >
            <span className="elButtonIcon" aria-hidden="true">
              <IconPlus size={14} />
            </span>
            添加字段
          </button>
          <button type="button" className="elButton" onClick={() => setPreviewOpen(true)}>
            预览表单
          </button>
          <button
            type="button"
            className="elButton"
            onClick={() => {
              void navigator.clipboard.writeText(exportJson).then(
                () => showSuccess('表单 JSON 已复制'),
                () => showError('复制失败'),
              );
            }}
          >
            导出 JSON
          </button>
        </AdminToolbar>

        <AdminTable
          columns={[
            { key: 'label', title: '标签', width: 140 },
            { key: 'name', title: '字段名', width: 140 },
            { key: 'type', title: '类型', width: 120 },
            {
              key: 'required',
              title: '必填',
              width: 80,
              render: (row) => (row.required ? '是' : '否'),
            },
            { key: 'placeholder', title: '占位提示' },
            {
              key: 'actions',
              title: '操作',
              width: 160,
              render: (row) => {
                const item = row as unknown as FormField;
                return (
                  <div className="fnaRowActions">
                    <AdminLinkButton
                      icon="edit"
                      onClick={() => {
                        setForm({
                          id: item.id,
                          label: item.label,
                          name: item.name,
                          type: item.type,
                          required: item.required,
                          placeholder: item.placeholder,
                        });
                        setOpen(true);
                      }}
                    >
                      编辑
                    </AdminLinkButton>
                    <AdminLinkButton
                      icon="delete"
                      onClick={() =>
                        setFields((current) => current.filter((entry) => entry.id !== item.id))
                      }
                    >
                      删除
                    </AdminLinkButton>
                  </div>
                );
              },
            },
          ]}
          rows={fields as unknown as Array<Record<string, unknown>>}
        />
      </AdminCard>

      <AdminDialog
        open={open}
        title={form.id ? '编辑字段' : '添加字段'}
        onClose={() => setOpen(false)}
        onConfirm={saveField}
        width={480}
      >
        <div className="adminForm fnaDialogForm">
          <AdminField label="标签">
            <input
              value={form.label}
              onChange={(event) => setForm((c) => ({ ...c, label: event.target.value }))}
            />
          </AdminField>
          <AdminField label="字段名">
            <input
              value={form.name}
              onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
            />
          </AdminField>
          <AdminField label="类型">
            <select
              value={form.type}
              onChange={(event) => setForm((c) => ({ ...c, type: event.target.value }))}
            >
              <option value="input">input</option>
              <option value="select">select</option>
              <option value="switch">switch</option>
              <option value="textarea">textarea</option>
            </select>
          </AdminField>
          <AdminField label="必填">
            <select
              value={form.required ? '1' : '0'}
              onChange={(event) =>
                setForm((c) => ({ ...c, required: event.target.value === '1' }))
              }
            >
              <option value="1">是</option>
              <option value="0">否</option>
            </select>
          </AdminField>
          <AdminField label="占位提示">
            <input
              value={form.placeholder}
              onChange={(event) => setForm((c) => ({ ...c, placeholder: event.target.value }))}
            />
          </AdminField>
        </div>
      </AdminDialog>

      <AdminDialog
        open={previewOpen}
        title="表单预览"
        onClose={() => setPreviewOpen(false)}
        onConfirm={() => {
          showSuccess('预览提交成功（演示）');
          setPreviewOpen(false);
        }}
        confirmLabel="提交"
        width={560}
      >
        <div className="adminForm fnaDialogForm">
          {fields.map((field) => (
            <AdminField key={field.id} label={field.label}>
              {field.type === 'textarea' ? (
                <textarea
                  rows={3}
                  placeholder={field.placeholder}
                  value={previewValues[field.name] || ''}
                  onChange={(event) =>
                    setPreviewValues((current) => ({
                      ...current,
                      [field.name]: event.target.value,
                    }))
                  }
                />
              ) : field.type === 'select' ? (
                <select
                  value={previewValues[field.name] || ''}
                  onChange={(event) =>
                    setPreviewValues((current) => ({
                      ...current,
                      [field.name]: event.target.value,
                    }))
                  }
                >
                  <option value="">{field.placeholder || '请选择'}</option>
                  <option value="a">选项 A</option>
                  <option value="b">选项 B</option>
                </select>
              ) : field.type === 'switch' ? (
                <input
                  type="checkbox"
                  checked={previewValues[field.name] === '1'}
                  onChange={(event) =>
                    setPreviewValues((current) => ({
                      ...current,
                      [field.name]: event.target.checked ? '1' : '0',
                    }))
                  }
                />
              ) : (
                <input
                  placeholder={field.placeholder}
                  value={previewValues[field.name] || ''}
                  onChange={(event) =>
                    setPreviewValues((current) => ({
                      ...current,
                      [field.name]: event.target.value,
                    }))
                  }
                />
              )}
            </AdminField>
          ))}
        </div>
      </AdminDialog>
      {ToastHost}
    </AdminPage>
  );
}
