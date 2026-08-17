'use client';

import { useEffect, useState } from 'react';
import {
  AdminConfirmDialog,
  AdminDialog,
  AdminField,
  AdminLinkButton,
  AdminPage,
  AdminCard,
  AdminTable,
  AdminToolbar,
  useAdminToast,
} from '@/components/admin/admin-primitives';
import { apiFetch } from '@/lib/api/client';
import { Can, useAuth } from '@/providers/auth-provider';
import { flattenMenuTree } from '@/lib/utils/menu-access';
import type { SystemMenuTreeNode } from '@/lib/types/system';

export function SystemMenusPage() {
  const { refresh } = useAuth();
  const { showSuccess, showError, ToastHost } = useAdminToast();
  const [menus, setMenus] = useState<SystemMenuTreeNode[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SystemMenuTreeNode | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [form, setForm] = useState({
    id: '',
    parentId: '0',
    path: '',
    name: '',
    component: '',
    title: '',
    icon: 'CircleHelp',
    hidden: false,
    sort: 1,
    keepAlive: false,
    menuBtns: '',
  });

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      try {
        const payload = await apiFetch<{ menus: SystemMenuTreeNode[] }>('/api/system/menus');
        if (!cancelled) {
          setMenus(payload.data.menus);
        }
      } catch {
        // 列表加载失败不打断页面；交互操作使用 toast
      }
    }

    void sync();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const flat = flattenMenuTree(menus);

  function openCreate(parentId = '0') {
    setForm({
      id: '',
      parentId,
      path: '',
      name: '',
      component: '',
      title: '',
      icon: 'CircleHelp',
      hidden: false,
      sort: flat.length + 1,
      keepAlive: false,
      menuBtns: '',
    });
    setDialogOpen(true);
  }

  function openEdit(menu: SystemMenuTreeNode) {
    setForm({
      id: menu.id,
      parentId: menu.parentId,
      path: menu.path,
      name: menu.name,
      component: menu.component,
      title: menu.title,
      icon: menu.icon,
      hidden: menu.hidden,
      sort: menu.sort,
      keepAlive: menu.keepAlive,
      menuBtns: menu.menuBtns.join(','),
    });
    setDialogOpen(true);
  }

  async function saveMenu() {
    setBusy(true);
    const payload = {
      ...form,
      menuBtns: form.menuBtns
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    };
    try {
      if (form.id) {
        await apiFetch('/api/system/menus', { method: 'PUT', body: JSON.stringify(payload) });
        showSuccess('编辑成功');
      } else {
        const { id, ...createBody } = payload;
        void id;
        await apiFetch('/api/system/menus', { method: 'POST', body: JSON.stringify(createBody) });
        showSuccess('创建成功');
      }
      setDialogOpen(false);
      setReloadToken((value) => value + 1);
      await refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return;
    }
    try {
      await apiFetch('/api/system/menus', {
        method: 'DELETE',
        body: JSON.stringify({ id: deleteTarget.id }),
      });
      showSuccess('删除成功');
      setDeleteTarget(null);
      setReloadToken((value) => value + 1);
      await refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : '删除失败');
    }
  }

  return (
    <AdminPage>
      {ToastHost}
      <AdminCard>
      <AdminToolbar>
        <Can btn="menu:add">
          <button type="button" className="elButton elButtonPrimary" onClick={() => openCreate()}>
            新增根菜单
          </button>
        </Can>
      </AdminToolbar>
      <AdminTable
        columns={[
          { key: 'title', title: '展示名称' },
          { key: 'path', title: '路由path' },
          { key: 'name', title: '路由Name' },
          { key: 'component', title: '文件路径' },
          { key: 'icon', title: '图标' },
          {
            key: 'hidden',
            title: '隐藏',
            width: 80,
            render: (row) => (row.hidden ? '是' : '否'),
          },
          { key: 'sort', title: '排序', width: 80 },
          {
            key: 'actions',
            title: '操作',
            width: 220,
            render: (row) => {
              const menu = row as unknown as SystemMenuTreeNode;
              return (
                <div className="gvaRowActions">
                  <Can btn="menu:add">
                    <AdminLinkButton onClick={() => openCreate(menu.id)}>添加子菜单</AdminLinkButton>
                  </Can>
                  <Can btn="menu:edit">
                    <AdminLinkButton onClick={() => openEdit(menu)}>编辑</AdminLinkButton>
                  </Can>
                  <Can btn="menu:delete">
                    <AdminLinkButton danger onClick={() => setDeleteTarget(menu)}>
                      删除
                    </AdminLinkButton>
                  </Can>
                </div>
              );
            },
          },
        ]}
        rows={flat as unknown as Array<Record<string, unknown>>}
      />
      </AdminCard>

      <AdminDialog
        open={dialogOpen}
        title={form.id ? '编辑菜单' : '新增菜单'}
        onClose={() => setDialogOpen(false)}
        onConfirm={() => void saveMenu()}
        busy={busy}
        width="40%"
      >
        <div className="adminForm gvaDialogForm">
          <AdminField label="父节点ID">
            <input
              value={form.parentId}
              onChange={(event) => setForm((current) => ({ ...current, parentId: event.target.value }))}
            />
          </AdminField>
          <AdminField label="展示名称">
            <input
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            />
          </AdminField>
          <AdminField label="路由path">
            <input
              value={form.path}
              onChange={(event) => setForm((current) => ({ ...current, path: event.target.value }))}
            />
          </AdminField>
          <AdminField label="路由Name">
            <input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </AdminField>
          <AdminField label="文件路径">
            <input
              value={form.component}
              onChange={(event) =>
                setForm((current) => ({ ...current, component: event.target.value }))
              }
            />
          </AdminField>
          <AdminField label="图标">
            <input
              value={form.icon}
              onChange={(event) => setForm((current) => ({ ...current, icon: event.target.value }))}
            />
          </AdminField>
          <AdminField label="排序标记">
            <input
              type="number"
              value={form.sort}
              onChange={(event) =>
                setForm((current) => ({ ...current, sort: Number(event.target.value) || 0 }))
              }
            />
          </AdminField>
          <AdminField label="按钮权限">
            <input
              value={form.menuBtns}
              placeholder="逗号分隔"
              onChange={(event) =>
                setForm((current) => ({ ...current, menuBtns: event.target.value }))
              }
            />
          </AdminField>
          <label className="adminTreeItem">
            <input
              type="checkbox"
              checked={form.hidden}
              onChange={(event) =>
                setForm((current) => ({ ...current, hidden: event.target.checked }))
              }
            />
            <span>是否隐藏</span>
          </label>
          <label className="adminTreeItem">
            <input
              type="checkbox"
              checked={form.keepAlive}
              onChange={(event) =>
                setForm((current) => ({ ...current, keepAlive: event.target.checked }))
              }
            />
            <span>是否缓存</span>
          </label>
        </div>
      </AdminDialog>

      <AdminConfirmDialog
        open={Boolean(deleteTarget)}
        message="确定要删除吗?"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </AdminPage>
  );
}
