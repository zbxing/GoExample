'use client';

import { useMemo, useState } from 'react';
import {
  AdminCard,
  AdminDialog,
  AdminField,
  AdminPage,
  AdminTable,
  AdminToolbar,
  AdminWarningBar,
  useAdminToast,
} from '@/components/admin/admin-primitives';

type FieldRow = {
  id: string;
  columnName: string;
  fieldName: string;
  fieldDesc: string;
  fieldType: string;
  required: boolean;
};

const SAMPLE_FIELDS: FieldRow[] = [
  {
    id: '1',
    columnName: 'id',
    fieldName: 'ID',
    fieldDesc: '主键',
    fieldType: 'uint',
    required: true,
  },
  {
    id: '2',
    columnName: 'name',
    fieldName: 'Name',
    fieldDesc: '名称',
    fieldType: 'string',
    required: true,
  },
  {
    id: '3',
    columnName: 'status',
    fieldName: 'Status',
    fieldDesc: '状态',
    fieldType: 'bool',
    required: false,
  },
  {
    id: '4',
    columnName: 'created_at',
    fieldName: 'CreatedAt',
    fieldDesc: '创建时间',
    fieldType: 'time.Time',
    required: false,
  },
];

const PREVIEW_CODE = `package example

type Example struct {
  ID        uint      \`json:"ID" gorm:"primarykey"\`
  Name      string    \`json:"name"\`
  Status    bool      \`json:"status"\`
  CreatedAt time.Time \`json:"createdAt"\`
}
`;

export function AutoCodePage() {
  const { showSuccess, ToastHost } = useAdminToast();
  const [step, setStep] = useState(1);
  const [db, setDb] = useState('gva');
  const [table, setTable] = useState('examples');
  const [structName, setStructName] = useState('Example');
  const [packageName, setPackageName] = useState('example');
  const [fields, setFields] = useState(SAMPLE_FIELDS);
  const [previewOpen, setPreviewOpen] = useState(false);

  const steps = useMemo(
    () => [
      { id: 1, label: '选择数据库' },
      { id: 2, label: '配置字段' },
      { id: 3, label: '生成预览' },
    ],
    [],
  );

  return (
    <AdminPage>
      <AdminWarningBar title="代码生成器演示壳：不连接真实数据库，也不会写入服务端文件。" />
      <div className="fnaToolWizard">
        <div className="fnaToolSteps">
          {steps.map((item) => (
            <span
              key={item.id}
              className={`fnaToolStep${item.id === step ? ' is-active' : ''}`}
            >
              {item.id}. {item.label}
            </span>
          ))}
        </div>

        {step === 1 ? (
          <AdminCard>
            <div className="adminForm fnaDialogForm">
              <AdminField label="数据库">
                <select value={db} onChange={(event) => setDb(event.target.value)}>
                  <option value="gva">gva</option>
                  <option value="demo">demo</option>
                </select>
              </AdminField>
              <AdminField label="数据表">
                <select value={table} onChange={(event) => setTable(event.target.value)}>
                  <option value="examples">examples</option>
                  <option value="customers">customers</option>
                </select>
              </AdminField>
              <AdminField label="结构体名">
                <input
                  value={structName}
                  onChange={(event) => setStructName(event.target.value)}
                />
              </AdminField>
              <AdminField label="包名">
                <input
                  value={packageName}
                  onChange={(event) => setPackageName(event.target.value)}
                />
              </AdminField>
            </div>
            <AdminToolbar>
              <button type="button" className="elButton elButtonPrimary" onClick={() => setStep(2)}>
                下一步
              </button>
            </AdminToolbar>
          </AdminCard>
        ) : null}

        {step === 2 ? (
          <AdminCard>
            <AdminToolbar>
              <button type="button" className="elButton" onClick={() => setStep(1)}>
                上一步
              </button>
              <button
                type="button"
                className="elButton"
                onClick={() =>
                  setFields((current) => [
                    ...current,
                    {
                      id: String(Date.now()),
                      columnName: 'field',
                      fieldName: 'Field',
                      fieldDesc: '新字段',
                      fieldType: 'string',
                      required: false,
                    },
                  ])
                }
              >
                添加字段
              </button>
              <button type="button" className="elButton elButtonPrimary" onClick={() => setStep(3)}>
                下一步
              </button>
            </AdminToolbar>
            <AdminTable
              columns={[
                { key: 'columnName', title: '列名', width: 140 },
                { key: 'fieldName', title: '字段名', width: 140 },
                { key: 'fieldDesc', title: '中文名', width: 140 },
                { key: 'fieldType', title: '类型', width: 120 },
                {
                  key: 'required',
                  title: '必填',
                  width: 80,
                  render: (row) => (row.required ? '是' : '否'),
                },
                {
                  key: 'actions',
                  title: '操作',
                  width: 100,
                  render: (row) => (
                    <button
                      type="button"
                      className="fnaLinkButton"
                      onClick={() =>
                        setFields((current) => current.filter((item) => item.id !== row.id))
                      }
                    >
                      删除
                    </button>
                  ),
                },
              ]}
              rows={fields as unknown as Array<Record<string, unknown>>}
            />
          </AdminCard>
        ) : null}

        {step === 3 ? (
          <AdminCard>
            <p>
              将基于 <strong>{db}.{table}</strong> 生成结构体 <strong>{structName}</strong>（包{' '}
              <strong>{packageName}</strong>），共 {fields.length} 个字段。
            </p>
            <AdminToolbar>
              <button type="button" className="elButton" onClick={() => setStep(2)}>
                上一步
              </button>
              <button
                type="button"
                className="elButton"
                onClick={() => setPreviewOpen(true)}
              >
                预览代码
              </button>
              <button
                type="button"
                className="elButton elButtonPrimary"
                onClick={() => showSuccess('已模拟生成（未写入磁盘）')}
              >
                生成代码
              </button>
            </AdminToolbar>
          </AdminCard>
        ) : null}
      </div>

      <AdminDialog
        open={previewOpen}
        title="代码预览"
        onClose={() => setPreviewOpen(false)}
        cancelLabel="关闭"
        variant="dialog"
        width={720}
      >
        <pre className="fnaCodeBlock">{PREVIEW_CODE}</pre>
      </AdminDialog>
      {ToastHost}
    </AdminPage>
  );
}
