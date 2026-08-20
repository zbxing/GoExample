'use client';

import {
  useEffect,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from 'react';

export function AdminPage({
  children,
}: PropsWithChildren<{ title?: string; actions?: ReactNode; extra?: ReactNode }>) {
  return <div className="gvaSystemPage">{children}</div>;
}

export function AdminCard({ children }: PropsWithChildren) {
  // 对齐 GVA gva-table-box：仅表面容器，不要叠加 gvaTableBox（会把圆角盖成 4px）
  return <div className="gvaSystemCard">{children}</div>;
}

export function AdminWarningBar({ title }: { title: string }) {
  return (
    <div className="gvaWarningBar" role="note">
      {title}
    </div>
  );
}

export function AdminSearchForm({
  children,
  onSearch,
  onReset,
}: PropsWithChildren<{ onSearch: () => void; onReset: () => void }>) {
  return (
    <div className="gvaSearchBox">
      <form
        className="gvaSearchForm gvaSearchFormInline"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
      >
        <div className="gvaSearchFields">{children}</div>
        <div className="gvaSearchActions">
          <button type="submit" className="elButton elButtonPrimary">
            <span className="elButtonIcon" aria-hidden="true">
              ⌕
            </span>
            查询
          </button>
          <button type="button" className="elButton" onClick={onReset}>
            <span className="elButtonIcon" aria-hidden="true">
              ↻
            </span>
            重置
          </button>
        </div>
      </form>
    </div>
  );
}

export function AdminField({
  label,
  children,
}: PropsWithChildren<{ label: string }>) {
  return (
    <label className="gvaField gvaFieldInline">
      <span className="gvaFieldLabel">{label}</span>
      <span className="gvaFieldControl">{children}</span>
    </label>
  );
}

export function AdminToolbar({ children }: PropsWithChildren) {
  return <div className="gvaTableToolbar">{children}</div>;
}

/** @deprecated Prefer AdminSearchForm for GVA parity */
export function AdminSearchBar({
  value,
  onChange,
  placeholder = '搜索',
  actions,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="adminToolbar">
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {actions}
    </div>
  );
}

export function AdminTable({
  columns,
  rows,
  emptyText = '暂无数据',
  stripe = true,
  border = true,
}: {
  columns: Array<{
    key: string;
    title: string;
    width?: number | string;
    render?: (row: Record<string, unknown>) => ReactNode;
  }>;
  rows: Array<Record<string, unknown>>;
  emptyText?: string;
  stripe?: boolean;
  border?: boolean;
}) {
  if (rows.length === 0) {
    return <div className="adminEmpty">{emptyText}</div>;
  }

  return (
    <div className={border ? 'adminTableWrap gvaTableBox' : 'adminTableWrap'}>
      <table
        className={
          stripe ? 'adminTable gvaElTable gvaElTableStripe' : 'adminTable gvaElTable'
        }
      >
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} style={column.width ? { width: column.width } : undefined}>
                {column.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String(row.id ?? index)} className={stripe && index % 2 === 1 ? 'is-striped' : undefined}>
              {columns.map((column) => (
                <td key={column.key}>
                  {column.render ? column.render(row) : String(row[column.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminPagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="adminPagination gvaPagination">
      <span>共 {total} 条</span>
      {onPageSizeChange ? (
        <select
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          aria-label="每页条数"
        >
          {[10, 20, 30, 50].map((size) => (
            <option key={size} value={size}>
              {size} 条/页
            </option>
          ))}
        </select>
      ) : null}
      <button
        type="button"
        className="elButton"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        上一页
      </button>
      <span>
        {page} / {pageCount}
      </span>
      <button
        type="button"
        className="elButton"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        下一页
      </button>
    </div>
  );
}

export function AdminDialog({
  open,
  title,
  onClose,
  onConfirm,
  confirmLabel = '确 定',
  cancelLabel = '取 消',
  children,
  busy = false,
  width = 560,
  variant = 'drawer',
}: PropsWithChildren<{
  open: boolean;
  title: string;
  onClose: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  width?: number | string;
  variant?: 'drawer' | 'dialog';
}>) {
  if (!open) {
    return null;
  }

  if (variant === 'dialog') {
    return (
      <div className="adminDialogBackdrop" role="presentation" onClick={onClose}>
        <div
          className="adminDialog gvaDialog"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          style={{ width }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="adminDialogHeader">
            <strong>{title}</strong>
            <button type="button" className="gvaIconButton" onClick={onClose} aria-label="关闭">
              ×
            </button>
          </div>
          <div className="adminDialogBody">{children}</div>
          <div className="adminDialogFooter">
            <button type="button" className="elButton" onClick={onClose} disabled={busy}>
              {cancelLabel}
            </button>
            {onConfirm ? (
              <button
                type="button"
                className="elButton elButtonPrimary"
                onClick={onConfirm}
                disabled={busy}
              >
                {busy ? '提交中…' : confirmLabel}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="gvaFormDrawerRoot">
      <button type="button" className="gvaFormDrawerMask" aria-label="关闭" onClick={onClose} />
      <aside
        className="gvaFormDrawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width: typeof width === 'number' ? Math.max(width, 360) : width }}
      >
        <header className="gvaFormDrawerHeader">
          <span>{title}</span>
          <div className="gvaFormDrawerActions">
            <button type="button" className="elButton" onClick={onClose} disabled={busy}>
              {cancelLabel}
            </button>
            {onConfirm ? (
              <button
                type="button"
                className="elButton elButtonPrimary"
                onClick={onConfirm}
                disabled={busy}
              >
                {busy ? '提交中…' : confirmLabel}
              </button>
            ) : null}
          </div>
        </header>
        <div className="gvaFormDrawerBody">{children}</div>
      </aside>
    </div>
  );
}

export function AdminTree({
  nodes,
  selectedIds,
  onToggle,
}: {
  nodes: Array<{
    id: string;
    title: string;
    children?: Array<{ id: string; title: string; children?: unknown[] }>;
  }>;
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  return <div className="adminTree">{renderNodes(nodes, selectedIds, onToggle, 0)}</div>;
}

function renderNodes(
  nodes: Array<{
    id: string;
    title: string;
    children?: Array<{ id: string; title: string; children?: unknown[] }>;
  }>,
  selectedIds: string[],
  onToggle: (id: string) => void,
  depth: number,
): ReactNode {
  return nodes.map((node) => (
    <div key={node.id}>
      <label className="adminTreeItem" style={{ ['--depth' as string]: depth }}>
        <input
          type="checkbox"
          checked={selectedIds.includes(node.id)}
          onChange={() => onToggle(node.id)}
        />
        <span>{node.title}</span>
      </label>
      {node.children && node.children.length > 0
        ? renderNodes(
            node.children as Array<{
              id: string;
              title: string;
              children?: Array<{ id: string; title: string; children?: unknown[] }>;
            }>,
            selectedIds,
            onToggle,
            depth + 1,
          )
        : null}
    </div>
  ));
}

export function AdminLinkButton({
  children,
  onClick,
  danger = false,
  disabled = false,
}: PropsWithChildren<{ onClick: () => void; danger?: boolean; disabled?: boolean }>) {
  return (
    <button
      type="button"
      className={danger ? 'gvaLinkButton danger' : 'gvaLinkButton'}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function AdminConfirmDialog({
  open,
  title = '提示',
  message,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title?: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="adminDialogBackdrop" role="presentation" onClick={onCancel}>
      <div
        className="adminDialog gvaDialog gvaConfirmDialog"
        role="alertdialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="adminDialogHeader">
          <strong>{title}</strong>
        </div>
        <div className="adminDialogBody">
          <p className="gvaConfirmMessage">{message}</p>
        </div>
        <div className="adminDialogFooter">
          <button type="button" className="elButton" onClick={onCancel}>
            取 消
          </button>
          <button type="button" className="elButton elButtonPrimary" onClick={onConfirm}>
            确 定
          </button>
        </div>
      </div>
    </div>
  );
}

export function useAdminToast() {
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(
    null,
  );

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const showSuccess = (message: string) => {
    setToast({ type: 'success', message });
  };
  const showError = (message: string) => {
    setToast({ type: 'error', message });
  };
  const showWarning = (message: string) => {
    setToast({ type: 'warning', message });
  };

  return {
    toast,
    showSuccess,
    showError,
    showWarning,
    ToastHost: toast ? (
      <div className={`gvaMessage gvaMessage-${toast.type}`} role="status">
        <span className="gvaMessageIcon" aria-hidden="true" />
        <span>{toast.message}</span>
      </div>
    ) : null,
  };
}

export function AdminSwitch({
  checked,
  onChange,
  activeText = '启用',
  inactiveText = '禁用',
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  activeText?: string;
  inactiveText?: string;
}) {
  return (
    <button
      type="button"
      className={checked ? 'gvaSwitch is-on' : 'gvaSwitch'}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    >
      <span className="gvaSwitchCore" />
      <span className="gvaSwitchLabel">{checked ? activeText : inactiveText}</span>
    </button>
  );
}
