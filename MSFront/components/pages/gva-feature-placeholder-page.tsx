'use client';

import { AdminCard, AdminPage } from '@/components/admin/admin-primitives';

export function GvaFeaturePlaceholderPage({
  title,
  description,
  bullets = [
    '页面结构已按 gin-vue-admin 菜单对齐，便于后续接入真实业务接口。',
    '可在菜单管理中调整显隐、排序与按钮权限。',
    '当前为占位内容，不影响既有权限与路由体系。',
  ],
}: {
  title: string;
  description: string;
  bullets?: string[];
}) {
  return (
    <AdminPage>
      <AdminCard>
        <div className="gvaFeaturePlaceholder">
          <h2 className="gvaFeaturePlaceholderTitle">{title}</h2>
          <p className="gvaFeaturePlaceholderDesc">{description}</p>
          <ul className="gvaFeaturePlaceholderList">
            {bullets.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </AdminCard>
    </AdminPage>
  );
}
