'use client';

import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import {
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconCaretRight,
  IconCopy,
  IconDelete,
  IconEdit,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSetting,
  IconUser,
  IconWarningFilled,
} from '@/components/admin/admin-icons';
import {
  getFnaActiveRequestCount,
  getFnaContentLoadingVisible,
  subscribeFnaPageLoading,
} from '@/lib/utils/fna-page-loading';
import { showFnaMessage } from '@/lib/utils/fna-message';

export function AdminPage({
  children,
}: PropsWithChildren<{ title?: string; actions?: ReactNode; extra?: ReactNode }>) {
  return <div className="fnaSystemPage">{children}</div>;
}

export function AdminCard({ children }: PropsWithChildren) {
  // 对齐 gin-vue-admin fna-table-box：仅表面容器，不要叠加 fnaTableBox（会把圆角盖成 4px）
  return <div className="fnaSystemCard">{children}</div>;
}

export function AdminWarningBar({ title }: { title: string }) {
  return (
    <div className="fnaWarningBar" role="note">
      <IconWarningFilled size={14} />
      <span>{title}</span>
    </div>
  );
}

export function AdminSearchForm({
  children,
  onSearch,
  onReset,
}: PropsWithChildren<{ onSearch: () => void; onReset: () => void }>) {
  return (
    <div className="fnaSearchBox">
      <form
        className="fnaSearchForm fnaSearchFormInline"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
      >
        <div className="fnaSearchFields">{children}</div>
        <div className="fnaSearchActions">
          <button type="submit" className="elButton elButtonPrimary">
            <span className="elButtonIcon" aria-hidden="true">
              <IconSearch size={14} />
            </span>
            查询
          </button>
          <button type="button" className="elButton" onClick={onReset}>
            <span className="elButtonIcon" aria-hidden="true">
              <IconRefresh size={14} />
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
    <label className="fnaField fnaFieldInline">
      <span className="fnaFieldLabel">{label}</span>
      <span className="fnaFieldControl">{children}</span>
    </label>
  );
}

export function AdminToolbar({ children }: PropsWithChildren) {
  return <div className="fnaTableToolbar">{children}</div>;
}

/** @deprecated Prefer AdminSearchForm for gin-vue-admin parity */
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

export type AdminTableColumn = {
  key: string;
  title: string;
  width?: number | string;
  minWidth?: number | string;
  sortable?: boolean;
  render?: (row: Record<string, unknown>) => ReactNode;
};

function adminTableColumnStyle(column: AdminTableColumn) {
  const style: { width?: number | string; minWidth?: number | string } = {};
  if (column.width != null) {
    style.width = column.width;
  }
  if (column.minWidth != null) {
    style.minWidth = column.minWidth;
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

export function AdminTable({
  columns,
  rows,
  emptyText = '暂无数据',
  loading = false,
  stripe = false,
  border = true,
  selectable = false,
  layout = 'auto',
  selectedIds,
  onSelectionChange,
  sortKey,
  sortOrder,
  onSortChange,
}: {
  columns: AdminTableColumn[];
  rows: Array<Record<string, unknown>>;
  emptyText?: string;
  /** 显式加载中；未传时也会在全局请求/列表首屏等待期间隐藏「暂无数据」 */
  loading?: boolean;
  stripe?: boolean;
  border?: boolean;
  selectable?: boolean;
  layout?: 'auto' | 'fixed';
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  sortKey?: string;
  sortOrder?: 'ascending' | 'descending' | null;
  onSortChange?: (key: string) => void;
}) {
  const contentLoading = useSyncExternalStore(
    subscribeFnaPageLoading,
    getFnaContentLoadingVisible,
    () => false,
  );
  const activeRequests = useSyncExternalStore(
    subscribeFnaPageLoading,
    getFnaActiveRequestCount,
    () => 0,
  );
  const showEmptyPlaceholder = loading || contentLoading || activeRequests > 0;
  const selected = selectedIds ?? [];
  const rowIds = rows.map((row, index) => String(row.id ?? index));
  const allSelected = rowIds.length > 0 && rowIds.every((id) => selected.includes(id));
  const someSelected = rowIds.some((id) => selected.includes(id));

  function toggleAll(checked: boolean) {
    if (!onSelectionChange) {
      return;
    }
    onSelectionChange(checked ? rowIds : []);
  }

  function toggleOne(id: string, checked: boolean) {
    if (!onSelectionChange) {
      return;
    }
    onSelectionChange(
      checked ? Array.from(new Set([...selected, id])) : selected.filter((item) => item !== id),
    );
  }

  return (
    <div className={border ? 'adminTableWrap fnaTableBox' : 'adminTableWrap'}>
      {rows.length === 0 ? (
        showEmptyPlaceholder ? (
          <div className="adminEmpty fnaTableEmpty fnaTableEmptyPending" aria-hidden="true" />
        ) : (
          <div className="adminEmpty fnaTableEmpty">{emptyText}</div>
        )
      ) : (
        <table
          className={[
            'adminTable',
            'fnaElTable',
            stripe ? 'fnaElTableStripe' : '',
            layout === 'fixed' ? 'fnaElTableFixed' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <thead>
            <tr>
              {selectable ? (
                <th className="fnaTableCheckCol" style={{ width: 55 }}>
                  <div className="fnaElTableCell">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(node) => {
                        if (node) {
                          node.indeterminate = !allSelected && someSelected;
                        }
                      }}
                      aria-label="全选"
                      onChange={(event) => toggleAll(event.target.checked)}
                    />
                  </div>
                </th>
              ) : null}
              {columns.map((column) => (
                <th
                  key={column.key}
                  style={adminTableColumnStyle(column)}
                  className={column.sortable ? 'fnaTableSortable' : undefined}
                  onClick={
                    column.sortable && onSortChange
                      ? () => onSortChange(column.key)
                      : undefined
                  }
                >
                  <div className="fnaElTableCell fnaTableHeadCell">
                    <span className="fnaTableHeadLabel">{column.title}</span>
                    {column.sortable ? (
                      <span
                        className={
                          sortKey === column.key && sortOrder
                            ? `fnaSortCaret is-${sortOrder}`
                            : 'fnaSortCaret'
                        }
                        aria-hidden="true"
                      />
                    ) : null}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const id = String(row.id ?? index);
              return (
                <tr
                  key={id}
                  className={stripe && index % 2 === 1 ? 'is-striped' : undefined}
                >
                  {selectable ? (
                    <td className="fnaTableCheckCol">
                      <div className="fnaElTableCell">
                        <input
                          type="checkbox"
                          checked={selected.includes(id)}
                          aria-label={`选择 ${id}`}
                          onChange={(event) => toggleOne(id, event.target.checked)}
                        />
                      </div>
                    </td>
                  ) : null}
                  {columns.map((column) => (
                    <td key={column.key} style={adminTableColumnStyle(column)}>
                      <div className="fnaElTableCell">
                        {column.render ? column.render(row) : String(row[column.key] ?? '')}
                      </div>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

const PAGE_SIZE_OPTIONS = [10, 30, 50, 100] as const;
const SELECT_ANIM_MS = 200;

export function AdminSelect({
  value,
  options,
  placeholder = '请选择',
  clearable: _clearable = false,
  placement = 'bottom',
  minWidth = 208,
  ariaLabel,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  /** 保留 API 兼容；选项列表不再注入「请选择」，清空请用重置或显式 onChange('') */
  clearable?: boolean;
  placement?: 'top' | 'bottom';
  minWidth?: number | string;
  ariaLabel?: string;
  onChange: (value: string) => void;
}) {
  void _clearable;
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [scrollThumb, setScrollThumb] = useState({
    visible: false,
    top: 0,
    height: 0,
  });
  const selected = options.find((item) => item.value === value);
  const close = useEffectEvent(() => setOpen(false));

  const syncScrollThumb = useEffectEvent(() => {
    const list = listRef.current;
    if (!list) {
      setScrollThumb({ visible: false, top: 0, height: 0 });
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = list;
    if (scrollHeight <= clientHeight + 1) {
      setScrollThumb({ visible: false, top: 0, height: 0 });
      return;
    }
    const rail = Math.max(clientHeight - 4, 1);
    const height = Math.max((clientHeight / scrollHeight) * rail, 24);
    const maxTop = Math.max(rail - height, 0);
    const top =
      scrollHeight === clientHeight
        ? 0
        : (scrollTop / (scrollHeight - clientHeight)) * maxTop;
    setScrollThumb({ visible: true, top: top + 2, height });
  });

  useEffect(() => {
    if (open) {
      setMounted(true);
      setVisible(false);
      const frame = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => setVisible(true));
      });
      return () => window.cancelAnimationFrame(frame);
    }
    setVisible(false);
    const timer = window.setTimeout(() => setMounted(false), SELECT_ANIM_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open || !mounted) {
      return;
    }
    syncScrollThumb();
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => syncScrollThumb());
    observer.observe(list);
    return () => observer.disconnect();
  }, [open, mounted, options]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        close();
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        close();
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={
        open
          ? `fnaSelect is-open is-placement-${placement}`
          : `fnaSelect is-placement-${placement}`
      }
      style={{ width: minWidth, minWidth, maxWidth: minWidth }}
    >
      <button
        type="button"
        className="fnaSelectTrigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel || placeholder}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={selected ? 'fnaSelectValue' : 'fnaSelectValue is-placeholder'}>
          {selected?.label || placeholder}
        </span>
        <IconArrowDown className="fnaSelectCaret" />
      </button>
      {mounted ? (
        <div
          className={[
            'fnaSelectDropdown',
            placement === 'bottom' ? 'is-bottom' : 'is-top',
            visible ? 'is-visible' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          role="listbox"
          aria-label={ariaLabel || placeholder}
        >
          <div className="fnaSelectDropdownArrow" aria-hidden="true" />
          <div className="fnaSelectOptionsWrap">
            <ul ref={listRef} className="fnaSelectOptions" onScroll={syncScrollThumb}>
              {options.map((option) => {
                const isSelected = option.value === value;
                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={isSelected ? 'fnaSelectOption is-selected' : 'fnaSelectOption'}
                      onClick={() => {
                        onChange(option.value);
                        setOpen(false);
                      }}
                    >
                      {option.label}
                    </button>
                  </li>
                );
              })}
            </ul>
            {scrollThumb.visible ? (
              <div className="fnaSelectScrollRail" aria-hidden="true">
                <div
                  className="fnaSelectScrollThumb"
                  style={{ top: scrollThumb.top, height: scrollThumb.height }}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AdminPageSizeSelect({
  value,
  options = PAGE_SIZE_OPTIONS,
  onChange,
}: {
  value: number;
  options?: readonly number[];
  onChange: (size: number) => void;
}) {
  return (
    <AdminSelect
      value={String(value)}
      ariaLabel="每页条数"
      placement="top"
      minWidth={110}
      options={options.map((size) => ({ value: String(size), label: `${size}条/页` }))}
      onChange={(next) => onChange(Number(next))}
    />
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
  const pageCount = Math.max(1, Math.ceil(total / Math.max(pageSize, 1)));
  const current = Math.min(Math.max(1, page), pageCount);
  const [jumpValue, setJumpValue] = useState(String(current));

  useEffect(() => {
    setJumpValue(String(current));
  }, [current]);

  const pages = useMemo(() => buildPagerItems(current, pageCount), [current, pageCount]);

  function goTo(next: number) {
    const clamped = Math.min(Math.max(1, next), pageCount);
    if (clamped !== page) {
      onPageChange(clamped);
    }
  }

  function commitJump() {
    const parsed = Number.parseInt(jumpValue, 10);
    if (Number.isFinite(parsed)) {
      goTo(parsed);
    } else {
      setJumpValue(String(current));
    }
  }

  return (
    <div className="adminPagination fnaPagination" role="navigation" aria-label="分页">
      <span className="fnaPaginationTotal">共 {total} 条</span>
      {onPageSizeChange ? (
        <AdminPageSizeSelect value={pageSize} onChange={onPageSizeChange} />
      ) : null}
      <button
        type="button"
        className="fnaPaginationBtn fnaPaginationNav"
        disabled={current <= 1}
        aria-label="上一页"
        onClick={() => goTo(current - 1)}
      >
        <IconArrowLeft />
      </button>
      <ul className="fnaPaginationPager">
        {pages.map((item, index) =>
          item === 'ellipsis' ? (
            <li key={`e-${index}`} className="fnaPaginationEllipsis" aria-hidden="true">
              <span className="fnaPaginationBtn is-ellipsis">
                <span className="fnaPaginationEllipsisDots">···</span>
              </span>
            </li>
          ) : (
            <li key={item}>
              <button
                type="button"
                className={
                  item === current ? 'fnaPaginationBtn is-active' : 'fnaPaginationBtn'
                }
                aria-current={item === current ? 'page' : undefined}
                onClick={() => goTo(item)}
              >
                {item}
              </button>
            </li>
          ),
        )}
      </ul>
      <button
        type="button"
        className="fnaPaginationBtn fnaPaginationNav"
        disabled={current >= pageCount}
        aria-label="下一页"
        onClick={() => goTo(current + 1)}
      >
        <IconArrowRight />
      </button>
      <span className="fnaPaginationJump">
        前往
        <input
          className="fnaPaginationJumpInput"
          value={jumpValue}
          inputMode="numeric"
          aria-label="页码"
          onChange={(event) => setJumpValue(event.target.value.replace(/[^\d]/g, ''))}
          onBlur={commitJump}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitJump();
            }
          }}
        />
        页
      </span>
    </div>
  );
}

function buildPagerItems(current: number, pageCount: number): Array<number | 'ellipsis'> {
  const pagerCount = 7;
  if (pageCount <= pagerCount) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const halfPagerCount = (pagerCount - 1) / 2;
  const showPrevMore = current > pagerCount - halfPagerCount;
  const showNextMore = current < pageCount - halfPagerCount;
  const items: Array<number | 'ellipsis'> = [1];

  if (!showPrevMore && showNextMore) {
    for (let page = 2; page < pagerCount; page += 1) {
      items.push(page);
    }
    items.push('ellipsis', pageCount);
    return items;
  }

  if (showPrevMore && !showNextMore) {
    items.push('ellipsis');
    const startPage = pageCount - (pagerCount - 2);
    for (let page = startPage; page <= pageCount; page += 1) {
      items.push(page);
    }
    return items;
  }

  items.push('ellipsis');
  const offset = Math.floor(pagerCount / 2) - 1;
  for (let page = current - offset; page <= current + offset; page += 1) {
    items.push(page);
  }
  items.push('ellipsis', pageCount);
  return items;
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
  width = 800,
  variant = 'drawer',
}: PropsWithChildren<{
  open: boolean;
  title: string;
  onClose: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  /** 对齐 gin-vue-admin appStore.drawerSize：桌面 800px，移动端请传 '100%' */
  width?: number | string;
  variant?: 'drawer' | 'dialog';
}>) {
  const [presented, setPresented] = useState(open);

  if (open && !presented) {
    setPresented(true);
  }

  const phase = open ? 'enter' : 'leave';

  useEffect(() => {
    if (!presented) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [presented, onClose]);

  if (variant === 'dialog') {
    if (!open) {
      return null;
    }

    return (
      <div className="adminDialogBackdrop" role="presentation" onClick={onClose}>
        <div
          className="adminDialog fnaDialog"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          style={{ width }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="adminDialogHeader">
            <strong>{title}</strong>
            <button type="button" className="fnaIconButton" onClick={onClose} aria-label="关闭">
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

  if (!presented) {
    return null;
  }

  return (
    <div className={`fnaFormDrawerRoot is-${phase}`}>
      <button type="button" className="fnaFormDrawerMask" aria-label="关闭" onClick={onClose} />
      <aside
        className="fnaFormDrawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width: typeof width === 'number' ? `${width}px` : width,
          maxWidth: '100vw',
        }}
        onAnimationEnd={(event) => {
          if (
            event.target !== event.currentTarget ||
            open ||
            event.animationName !== 'fna-rtl-drawer-out'
          ) {
            return;
          }
          setPresented(false);
        }}
      >
        <header className="fnaFormDrawerHeader">
          <span>{title}</span>
          <div className="fnaFormDrawerActions">
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
        <div className="fnaFormDrawerBody">{children}</div>
      </aside>
    </div>
  );
}

export function AdminTree({
  nodes,
  selectedIds,
  onToggle,
  disabledIds = [],
  defaultExpandAll = true,
}: {
  nodes: Array<{
    id: string;
    title: string;
    children?: Array<{ id: string; title: string; children?: unknown[] }>;
  }>;
  selectedIds: string[];
  onToggle: (id: string) => void;
  /** 不可勾选/取消的节点（如角色首页菜单对应角色） */
  disabledIds?: string[];
  /** 对齐 gin-vue-admin el-tree default-expand-all */
  defaultExpandAll?: boolean;
}) {
  const disabled = useMemo(() => new Set(disabledIds), [disabledIds]);
  // 用 id 序列作依赖，避免父组件每次 render 传入新 nodes 数组时重置展开态
  const branchIdKey = useMemo(() => collectBranchIds(nodes).join('\0'), [nodes]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    defaultExpandAll ? new Set(collectBranchIds(nodes)) : new Set(),
  );

  useEffect(() => {
    if (!defaultExpandAll) {
      return;
    }
    setExpandedIds(new Set(branchIdKey ? branchIdKey.split('\0') : []));
  }, [branchIdKey, defaultExpandAll]);

  function toggleExpand(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="adminTree">
      {renderNodes(nodes, selectedIds, onToggle, disabled, expandedIds, toggleExpand, 0)}
    </div>
  );
}

function collectBranchIds(
  nodes: Array<{
    id: string;
    children?: Array<{ id: string; children?: unknown[] }>;
  }>,
): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      ids.push(node.id);
      ids.push(
        ...collectBranchIds(
          node.children as Array<{ id: string; children?: Array<{ id: string; children?: unknown[] }> }>,
        ),
      );
    }
  }
  return ids;
}

function renderNodes(
  nodes: Array<{
    id: string;
    title: string;
    children?: Array<{ id: string; title: string; children?: unknown[] }>;
  }>,
  selectedIds: string[],
  onToggle: (id: string) => void,
  disabledIds: Set<string>,
  expandedIds: Set<string>,
  onToggleExpand: (id: string) => void,
  depth: number,
): ReactNode {
  return nodes.map((node) => {
    const isDisabled = disabledIds.has(node.id);
    const hasChildren = Boolean(node.children && node.children.length > 0);
    const expanded = expandedIds.has(node.id);

    return (
      <div key={node.id} className="adminTreeNode">
        <div
          className={isDisabled ? 'adminTreeItem is-disabled' : 'adminTreeItem'}
          style={{ ['--depth' as string]: depth }}
        >
          {hasChildren ? (
            <button
              type="button"
              className={expanded ? 'fnaTreeExpand is-expanded' : 'fnaTreeExpand'}
              aria-label={expanded ? '折叠' : '展开'}
              aria-expanded={expanded}
              onClick={() => onToggleExpand(node.id)}
            >
              <IconCaretRight size={12} />
            </button>
          ) : (
            <span className="fnaTreeExpandSpacer" aria-hidden="true" />
          )}
          <label className="adminTreeItemLabel">
            <input
              type="checkbox"
              checked={selectedIds.includes(node.id)}
              disabled={isDisabled}
              onChange={() => {
                if (!isDisabled) {
                  onToggle(node.id);
                }
              }}
            />
            <span>{node.title}</span>
          </label>
        </div>
        {hasChildren && expanded
          ? renderNodes(
              node.children as Array<{
                id: string;
                title: string;
                children?: Array<{ id: string; title: string; children?: unknown[] }>;
              }>,
              selectedIds,
              onToggle,
              disabledIds,
              expandedIds,
              onToggleExpand,
              depth + 1,
            )
          : null}
      </div>
    );
  });
}

export function AdminLinkButton({
  children,
  onClick,
  danger = false,
  disabled = false,
  icon,
}: PropsWithChildren<{
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  icon?: 'edit' | 'delete' | 'user' | 'setting' | 'plus' | 'copy' | ReactNode;
}>) {
  const iconNode =
    icon === 'edit' ? (
      <IconEdit size={14} />
    ) : icon === 'delete' ? (
      <IconDelete size={14} />
    ) : icon === 'user' ? (
      <IconUser size={14} />
    ) : icon === 'setting' ? (
      <IconSetting size={14} />
    ) : icon === 'plus' ? (
      <IconPlus size={14} />
    ) : icon === 'copy' ? (
      <IconCopy size={14} />
    ) : (
      icon
    );

  return (
    <button
      type="button"
      className={danger ? 'fnaLinkButton danger' : 'fnaLinkButton'}
      onClick={onClick}
      disabled={disabled}
    >
      {iconNode ? (
        <span className="fnaLinkButtonIcon" aria-hidden="true">
          {iconNode}
        </span>
      ) : null}
      {children}
    </button>
  );
}

const CONFIRM_ANIM_MS = 300;

export function AdminConfirmDialog({
  open,
  title = '提示',
  message,
  type = 'warning',
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title?: string;
  message: string;
  type?: 'warning' | 'info' | 'success' | 'error';
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setVisible(false);
      const frame = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => setVisible(true));
      });
      return () => window.cancelAnimationFrame(frame);
    }
    setVisible(false);
    const timer = window.setTimeout(() => setMounted(false), CONFIRM_ANIM_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCancel();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mounted, onCancel]);

  if (!mounted) {
    return null;
  }

  return (
    <div
      className={[
        'fnaMsgboxOverlay',
        open && visible ? 'is-enter' : '',
        !open ? 'is-leave' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="presentation"
      onClick={onCancel}
    >
      <div className="fnaMsgboxWrap">
        <div
          className="adminDialog fnaDialog fnaConfirmDialog fnaMsgbox"
          role="alertdialog"
          aria-modal="true"
          aria-label={title}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="adminDialogHeader fnaMsgboxHeader">
            <strong>{title}</strong>
          </div>
          <div className="adminDialogBody fnaMsgboxBody">
            <div className="fnaMsgboxContent">
              <span className={`fnaMsgboxStatus is-${type}`} aria-hidden="true">
                <IconWarningFilled size={24} />
              </span>
              <p className="fnaConfirmMessage">{message}</p>
            </div>
          </div>
          <div className="adminDialogFooter fnaMsgboxFooter">
            <button type="button" className="elButton" onClick={onCancel}>
              取 消
            </button>
            <button type="button" className="elButton elButtonPrimary" onClick={onConfirm}>
              确 定
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function useAdminToast() {
  const showSuccess = (message: string) => {
    showFnaMessage.success(message);
  };
  const showError = (message: string) => {
    showFnaMessage.error(message);
  };
  const showWarning = (message: string) => {
    showFnaMessage.warning(message);
  };

  return {
    showSuccess,
    showError,
    showWarning,
    /** @deprecated 已改用全局 FnaMessageHost，保留空节点以兼容现有页面写法 */
    ToastHost: null as ReactNode,
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
      className={checked ? 'fnaSwitch is-on' : 'fnaSwitch'}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    >
      <span className="fnaSwitchCore" />
      <span className="fnaSwitchLabel">{checked ? activeText : inactiveText}</span>
    </button>
  );
}
