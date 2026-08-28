'use client';

import { useMemo, useState } from 'react';
import { IconArrowRight, IconPlus } from '@/components/admin/admin-icons';
import {
  AdminConfirmDialog,
  AdminDialog,
  AdminLinkButton,
  AdminPage,
  AdminCard,
  AdminTable,
  AdminToolbar,
  AdminTree,
  AdminWarningBar,
  useAdminToast,
} from '@/components/admin/admin-primitives';
import { apiFetch } from '@/lib/api/client';
import { useGvaListLoad } from '@/lib/hooks/use-gva-list-load';
import { Can, useAuth } from '@/providers/auth-provider';
import {
  assignMenuLayerSequenceNos,
  buildMenuTreeFromFlat,
  flattenMenuTree,
  flattenVisibleMenuTree,
  GVA_MENU_COL_WIDTH,
  type MenuVisibleRow,
} from '@/lib/utils/menu-access';
import type { SystemMenuTreeNode, SystemRoleRecord } from '@/lib/types/system';

type MenuBtnRow = { name: string; desc: string };
type MenuParameterRow = { type: 'query' | 'params'; key: string; value: string };

type MenuFormState = {
  id: string;
  parentId: string;
  path: string;
  name: string;
  component: string;
  title: string;
  icon: string;
  hidden: boolean;
  sort: number;
  keepAlive: boolean;
  closeTab: boolean;
  defaultMenu: boolean;
  activeName: string;
  transitionType: string;
  parameters: MenuParameterRow[];
  menuBtns: MenuBtnRow[];
};

const emptyForm = (parentId = '0', sort = 1): MenuFormState => ({
  id: '',
  parentId,
  path: '',
  name: '',
  component: '',
  title: '',
  icon: 'CircleHelp',
  hidden: false,
  sort,
  keepAlive: false,
  closeTab: false,
  defaultMenu: false,
  activeName: '',
  transitionType: '',
  parameters: [],
  menuBtns: [],
});

type RoleTreeNode = SystemRoleRecord & { children: RoleTreeNode[] };

function buildRoleTree(roles: SystemRoleRecord[]): RoleTreeNode[] {
  const map = new Map<string, RoleTreeNode>();
  for (const role of roles) {
    map.set(role.id, { ...role, children: [] });
  }
  const roots: RoleTreeNode[] = [];
  for (const role of map.values()) {
    if (role.parentId && role.parentId !== '0' && map.has(role.parentId)) {
      map.get(role.parentId)!.children.push(role);
    } else {
      roots.push(role);
    }
  }
  return roots;
}

type AdminTreeNode = {
  id: string;
  title: string;
  children?: AdminTreeNode[];
};

function toTreeNodes(nodes: RoleTreeNode[]): AdminTreeNode[] {
  return nodes.map((node) => ({
    id: node.id,
    title: node.name,
    children: node.children.length > 0 ? toTreeNodes(node.children) : undefined,
  }));
}

export function SystemMenusPage() {
  const { refresh } = useAuth();
  const { showSuccess, showError, ToastHost } = useAdminToast();
  const [menus, setMenus] = useState<SystemMenuTreeNode[]>([]);
  const [roles, setRoles] = useState<SystemRoleRecord[]>([]);
  /** GVA el-table tree starts collapsed; expand ids live here */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignMenu, setAssignMenu] = useState<SystemMenuTreeNode | null>(null);
  const [assignRoleIds, setAssignRoleIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SystemMenuTreeNode | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [form, setForm] = useState<MenuFormState>(emptyForm());

  useGvaListLoad(() => {
    let cancelled = false;

    async function sync() {
      try {
        const [menuPayload, rolePayload] = await Promise.all([
          apiFetch<{ menus: SystemMenuTreeNode[] }>('/api/system/menus'),
          apiFetch<{ roles: SystemRoleRecord[] }>('/api/system/roles'),
        ]);
        if (!cancelled) {
          setMenus(menuPayload.data.menus);
          setRoles(rolePayload.data.roles);
        }
      } catch {
        // 列表加载失败不打断页面
      }
    }

    void sync();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const flat = useMemo(() => flattenMenuTree(menus), [menus]);
  const menuTree = useMemo(() => buildMenuTreeFromFlat(flat), [flat]);
  const sequenceNos = useMemo(() => assignMenuLayerSequenceNos(menuTree), [menuTree]);
  const visibleRows = useMemo(
    () => flattenVisibleMenuTree(menuTree, expanded, sequenceNos),
    [menuTree, expanded, sequenceNos],
  );
  const parentOptions = useMemo(
    () => [{ id: '0', title: '根节点' }, ...flat.map((menu) => ({ id: menu.id, title: menu.title }))],
    [flat],
  );
  const roleTree = useMemo(() => buildRoleTree(roles), [roles]);
  const assignRoleTreeNodes = useMemo(() => toTreeNodes(roleTree), [roleTree]);
  const dialogTitle = form.id
    ? '编辑菜单'
    : form.parentId && form.parentId !== '0'
      ? '添加子菜单'
      : '新增根菜单';

  function toggleExpand(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function openCreate(parentId = '0') {
    setForm(emptyForm(parentId, flat.length + 1));
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
      closeTab: false,
      defaultMenu: false,
      activeName: '',
      transitionType: '',
      parameters: (menu.parameters ?? []).map((item) => ({
        type: item.type === 'params' ? 'params' : 'query',
        key: item.key ?? '',
        value: item.value ?? '',
      })),
      menuBtns: menu.menuBtns.map((name) => ({ name, desc: '' })),
    });
    setDialogOpen(true);
  }

  function openAssign(menu: SystemMenuTreeNode) {
    setAssignMenu(menu);
    setAssignRoleIds(roles.filter((role) => role.menuIds.includes(menu.id)).map((role) => role.id));
    setAssignOpen(true);
  }

  async function saveMenu() {
    if (!form.title.trim() || !form.name.trim() || !form.component.trim()) {
      showError('请填写展示名称、路由 Name 与文件路径');
      return;
    }
    setBusy(true);
    const payload = {
      parentId: form.parentId,
      path: form.path.trim() || `/${form.name.trim()}`,
      name: form.name.trim(),
      component: form.component.trim(),
      title: form.title.trim(),
      icon: form.icon.trim() || 'CircleHelp',
      hidden: form.hidden,
      sort: form.sort,
      keepAlive: form.keepAlive,
      menuBtns: form.menuBtns.map((item) => item.name.trim()).filter(Boolean),
      parameters: form.parameters
        .map((item) => ({
          type: item.type,
          key: item.key.trim(),
          value: item.value.trim(),
        }))
        .filter((item) => item.key || item.value),
    };
    try {
      if (form.id) {
        await apiFetch('/api/system/menus', {
          method: 'PUT',
          body: JSON.stringify({ id: form.id, ...payload }),
        });
        showSuccess('编辑成功');
      } else {
        await apiFetch('/api/system/menus', { method: 'POST', body: JSON.stringify(payload) });
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

  async function confirmAssign() {
    if (!assignMenu) {
      return;
    }
    setBusy(true);
    const menuId = assignMenu.id;
    const selected = new Set(assignRoleIds);
    try {
      await Promise.all(
        roles.map(async (role) => {
          const has = role.menuIds.includes(menuId);
          const shouldHave = selected.has(role.id);
          if (has === shouldHave) {
            return;
          }
          const menuIds = shouldHave
            ? [...role.menuIds, menuId]
            : role.menuIds.filter((id) => id !== menuId);
          await apiFetch('/api/system/roles', {
            method: 'PUT',
            body: JSON.stringify({ id: role.id, menuIds }),
          });
        }),
      );
      showSuccess('分配成功');
      setAssignOpen(false);
      setReloadToken((value) => value + 1);
      await refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : '分配失败');
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

  const tableRows = visibleRows.map((menu) => ({
    ...menu,
    hiddenLabel: menu.hidden ? '隐藏' : '显示',
    iconLabel: menu.icon || '-',
  }));

  return (
    <AdminPage>
      {ToastHost}
      <AdminCard>
        <AdminToolbar>
          <Can btn="menu:add">
            <button type="button" className="elButton elButtonPrimary" onClick={() => openCreate('0')}>
              <span className="elButtonIcon" aria-hidden="true">
                <IconPlus size={14} />
              </span>
              新增根菜单
            </button>
          </Can>
        </AdminToolbar>
        <AdminTable
          layout="fixed"
          columns={[
            {
              key: 'id',
              title: 'ID',
              width: GVA_MENU_COL_WIDTH.id,
              render: (row) => {
                const menu = row as unknown as MenuVisibleRow;
                return (
                  <div className="gvaRoleIdCell">
                    {menu.depth > 0 ? (
                      <span className="gvaTreeIndent" style={{ width: menu.depth * 16 }} />
                    ) : null}
                    {menu.hasChildren ? (
                      <button
                        type="button"
                        className={
                          expanded.has(menu.id) ? 'gvaTreeExpand is-expanded' : 'gvaTreeExpand'
                        }
                        aria-label={expanded.has(menu.id) ? '折叠' : '展开'}
                        aria-expanded={expanded.has(menu.id)}
                        onClick={() => toggleExpand(menu.id)}
                      >
                        <IconArrowRight size={12} />
                      </button>
                    ) : (
                      <span className="gvaTreeExpandSpacer" />
                    )}
                    <span>{menu.seqNo}</span>
                  </div>
                );
              },
            },
            { key: 'title', title: '展示名称', width: GVA_MENU_COL_WIDTH.title },
            {
              key: 'icon',
              title: '图标',
              width: GVA_MENU_COL_WIDTH.icon,
              render: (row) => <span className="gvaMenuIconCell">{String(row.iconLabel ?? row.icon)}</span>,
            },
            { key: 'name', title: '路由Name', width: GVA_MENU_COL_WIDTH.name },
            { key: 'path', title: '路由Path', width: GVA_MENU_COL_WIDTH.path },
            {
              key: 'hidden',
              title: '是否隐藏',
              width: GVA_MENU_COL_WIDTH.hidden,
              render: (row) => String(row.hiddenLabel),
            },
            {
              key: 'parentId',
              title: '父节点',
              width: GVA_MENU_COL_WIDTH.parentId,
              render: (row) => {
                const menu = row as unknown as MenuVisibleRow;
                if (!menu.parentId || menu.parentId === '0') {
                  return '0';
                }
                return String(sequenceNos.get(String(menu.parentId)) ?? 0);
              },
            },
            { key: 'sort', title: '排序', width: GVA_MENU_COL_WIDTH.sort },
            { key: 'component', title: '文件路径', width: GVA_MENU_COL_WIDTH.component },
            {
              key: 'actions',
              title: '操作',
              width: GVA_MENU_COL_WIDTH.actions,
              render: (row) => {
                const menu = row as unknown as SystemMenuTreeNode;
                return (
                  <div className="gvaMenuRowActions">
                    <Can btn="menu:add">
                      <AdminLinkButton icon="plus" onClick={() => openCreate(menu.id)}>
                        添加子菜单
                      </AdminLinkButton>
                    </Can>
                    <Can btn="menu:edit">
                      <AdminLinkButton icon="edit" onClick={() => openEdit(menu)}>
                        编辑
                      </AdminLinkButton>
                    </Can>
                    <Can btn="menu:edit">
                      <AdminLinkButton icon="user" onClick={() => openAssign(menu)}>
                        分配角色
                      </AdminLinkButton>
                    </Can>
                    <Can btn="menu:delete">
                      <AdminLinkButton icon="delete" onClick={() => setDeleteTarget(menu)}>
                        删除
                      </AdminLinkButton>
                    </Can>
                  </div>
                );
              },
            },
          ]}
          rows={tableRows as unknown as Array<Record<string, unknown>>}
        />
      </AdminCard>

      <AdminDialog
        open={dialogOpen}
        title={dialogTitle}
        onClose={() => setDialogOpen(false)}
        onConfirm={() => void saveMenu()}
        busy={busy}
      >
        <AdminWarningBar title="新增菜单，需要在角色管理内配置权限才可使用" />
        <div className="gvaMenuForm">
          <section className="gvaMenuFormSection">
            <h3>基础信息</h3>
            <div className="gvaMenuFormGrid">
              <label className="gvaMenuFormItem gvaMenuFormItemFull">
                <span className="is-required">文件路径</span>
                <input
                  value={form.component}
                  placeholder="请输入文件路径"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, component: event.target.value }))
                  }
                />
                <p className="gvaMenuFormTip">
                  如果菜单包含子菜单，请创建 router-view 二级路由页面，或
                  <button
                    type="button"
                    className="gvaLinkButton"
                    onClick={() =>
                      setForm((current) => ({ ...current, component: 'view/routerHolder.vue' }))
                    }
                  >
                    点我设置
                  </button>
                </p>
              </label>
              <label className="gvaMenuFormItem">
                <span className="is-required">展示名称</span>
                <input
                  value={form.title}
                  placeholder="请输入菜单展示名称"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, title: event.target.value }))
                  }
                />
              </label>
              <label className="gvaMenuFormItem">
                <span className="is-required">路由Name</span>
                <input
                  value={form.name}
                  placeholder="唯一英文字符串"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </label>
            </div>
          </section>

          <section className="gvaMenuFormSection">
            <h3>路由配置</h3>
            <div className="gvaMenuFormGrid">
              <label className="gvaMenuFormItem">
                <span>父节点ID</span>
                <select
                  value={form.parentId}
                  disabled={!form.id}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, parentId: event.target.value }))
                  }
                >
                  {parentOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="gvaMenuFormItem">
                <span className="is-required">路由Path</span>
                <input
                  value={form.path}
                  placeholder="建议只在后方拼接参数"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, path: event.target.value }))
                  }
                />
              </label>
            </div>
          </section>

          <section className="gvaMenuFormSection">
            <h3>显示设置</h3>
            <div className="gvaMenuFormGrid gvaMenuFormGrid3">
              <label className="gvaMenuFormItem">
                <span>图标</span>
                <input
                  value={form.icon}
                  placeholder="请输入图标名"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, icon: event.target.value }))
                  }
                />
              </label>
              <label className="gvaMenuFormItem">
                <span>排序标记</span>
                <input
                  type="number"
                  value={form.sort}
                  placeholder="请输入排序数字"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      sort: Number(event.target.value) || 0,
                    }))
                  }
                />
              </label>
              <label className="gvaMenuFormItem">
                <span>是否隐藏</span>
                <select
                  value={form.hidden ? '1' : '0'}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, hidden: event.target.value === '1' }))
                  }
                >
                  <option value="0">否</option>
                  <option value="1">是</option>
                </select>
              </label>
            </div>
          </section>

          <section className="gvaMenuFormSection">
            <h3>高级配置</h3>
            <div className="gvaMenuFormGrid">
              <label className="gvaMenuFormItem">
                <span>高亮菜单</span>
                <input
                  value={form.activeName}
                  placeholder={form.name || '请输入高亮菜单名称'}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, activeName: event.target.value }))
                  }
                />
              </label>
              <label className="gvaMenuFormItem">
                <span>KeepAlive</span>
                <select
                  value={form.keepAlive ? '1' : '0'}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, keepAlive: event.target.value === '1' }))
                  }
                >
                  <option value="0">否</option>
                  <option value="1">是</option>
                </select>
              </label>
              <label className="gvaMenuFormItem">
                <span>CloseTab</span>
                <select
                  value={form.closeTab ? '1' : '0'}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, closeTab: event.target.value === '1' }))
                  }
                >
                  <option value="0">否</option>
                  <option value="1">是</option>
                </select>
              </label>
              <label className="gvaMenuFormItem">
                <span>是否为基础页面</span>
                <select
                  value={form.defaultMenu ? '1' : '0'}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, defaultMenu: event.target.value === '1' }))
                  }
                >
                  <option value="0">否</option>
                  <option value="1">是</option>
                </select>
              </label>
              <label className="gvaMenuFormItem">
                <span>路由切换动画</span>
                <select
                  value={form.transitionType}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, transitionType: event.target.value }))
                  }
                >
                  <option value="">跟随全局</option>
                  <option value="fade">淡入淡出</option>
                  <option value="slide">滑动</option>
                  <option value="zoom">缩放</option>
                  <option value="none">无动画</option>
                </select>
              </label>
            </div>
          </section>

          <section className="gvaMenuFormSection">
            <div className="gvaMenuFormSectionHead">
              <h3>菜单参数配置</h3>
              <button
                type="button"
                className="elButton elButtonPrimary elButtonSmall"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    parameters: [...current.parameters, { type: 'query', key: '', value: '' }],
                  }))
                }
              >
                新增菜单参数
              </button>
            </div>
            <div className="gvaMenuBtnTableWrap">
              <table className="gvaMenuBtnTable">
                <thead>
                  <tr>
                    <th style={{ width: 150 }}>参数类型</th>
                    <th style={{ width: 150 }}>参数key</th>
                    <th>参数值</th>
                    <th style={{ width: 90 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {form.parameters.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="gvaMenuBtnEmpty">
                        暂无数据
                      </td>
                    </tr>
                  ) : (
                    form.parameters.map((param, index) => (
                      <tr key={`param-${index}`}>
                        <td>
                          <select
                            value={param.type}
                            onChange={(event) =>
                              setForm((current) => {
                                const parameters = [...current.parameters];
                                parameters[index] = {
                                  ...parameters[index],
                                  type: event.target.value === 'params' ? 'params' : 'query',
                                };
                                return { ...current, parameters };
                              })
                            }
                          >
                            <option value="query">query</option>
                            <option value="params">params</option>
                          </select>
                        </td>
                        <td>
                          <input
                            value={param.key}
                            placeholder="请输入参数key"
                            onChange={(event) =>
                              setForm((current) => {
                                const parameters = [...current.parameters];
                                parameters[index] = {
                                  ...parameters[index],
                                  key: event.target.value,
                                };
                                return { ...current, parameters };
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            value={param.value}
                            placeholder="请输入参数值"
                            onChange={(event) =>
                              setForm((current) => {
                                const parameters = [...current.parameters];
                                parameters[index] = {
                                  ...parameters[index],
                                  value: event.target.value,
                                };
                                return { ...current, parameters };
                              })
                            }
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="elButton elButtonDanger elButtonSmall"
                            onClick={() =>
                              setForm((current) => ({
                                ...current,
                                parameters: current.parameters.filter((_, i) => i !== index),
                              }))
                            }
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="gvaMenuFormSection">
            <div className="gvaMenuFormSectionHead">
              <h3>可控按钮配置</h3>
              <button
                type="button"
                className="elButton elButtonPrimary elButtonSmall"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    menuBtns: [...current.menuBtns, { name: '', desc: '' }],
                  }))
                }
              >
                新增可控按钮
              </button>
            </div>
            <div className="gvaMenuBtnTableWrap">
              <table className="gvaMenuBtnTable">
                <thead>
                  <tr>
                    <th>按钮名称</th>
                    <th>备注</th>
                    <th style={{ width: 90 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {form.menuBtns.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="gvaMenuBtnEmpty">
                        暂无数据
                      </td>
                    </tr>
                  ) : (
                    form.menuBtns.map((btn, index) => (
                      <tr key={`btn-${index}`}>
                        <td>
                          <input
                            value={btn.name}
                            placeholder="请输入按钮名称"
                            onChange={(event) =>
                              setForm((current) => {
                                const menuBtns = [...current.menuBtns];
                                menuBtns[index] = { ...menuBtns[index], name: event.target.value };
                                return { ...current, menuBtns };
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            value={btn.desc}
                            placeholder="请输入按钮备注"
                            onChange={(event) =>
                              setForm((current) => {
                                const menuBtns = [...current.menuBtns];
                                menuBtns[index] = { ...menuBtns[index], desc: event.target.value };
                                return { ...current, menuBtns };
                              })
                            }
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="elButton elButtonDanger elButtonSmall"
                            onClick={() =>
                              setForm((current) => ({
                                ...current,
                                menuBtns: current.menuBtns.filter((_, i) => i !== index),
                              }))
                            }
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </AdminDialog>

      <AdminDialog
        open={assignOpen}
        title={assignMenu ? `分配角色 - ${assignMenu.title}` : '分配角色'}
        onClose={() => setAssignOpen(false)}
        onConfirm={() => void confirmAssign()}
        busy={busy}
      >
        <AdminWarningBar title="注：保存时将全量覆盖该菜单的角色关联关系；作为角色首页的菜单不可取消勾选" />
        <AdminTree
          nodes={assignRoleTreeNodes}
          selectedIds={assignRoleIds}
          disabledIds={
            assignMenu
              ? roles
                  .filter((role) => role.defaultRouter === assignMenu.path)
                  .map((role) => role.id)
              : []
          }
          onToggle={(id) => {
            setAssignRoleIds((current) =>
              current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
            );
          }}
        />
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
