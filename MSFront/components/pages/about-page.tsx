'use client';

import { AdminCard, AdminPage } from '@/components/admin/admin-primitives';

export function AboutPage() {
  return (
    <AdminPage>
      <AdminCard>
        <div className="gvaAboutPage">
          <div className="gvaAboutRow">
            <img src="/ga-logo.png" alt="" className="gvaAboutLogo" />
            <div>
              <h4>Go Admin / MSFront</h4>
              <p>基于 gin-vue-admin 思路落地的前后端分离管理台示例，聚焦权限、菜单与运维能力。</p>
              <div className="gvaAboutLinks">
                <a href="https://www.gin-vue-admin.com" target="_blank" rel="noreferrer">
                  官方文档
                </a>
                <span>·</span>
                <a href="https://github.com/flipped-aurora/gin-vue-admin" target="_blank" rel="noreferrer">
                  参考仓库
                </a>
                <span>·</span>
                <a href="http://demo.gin-vue-admin.com" target="_blank" rel="noreferrer">
                  在线演示
                </a>
              </div>
            </div>
          </div>
          <div className="gvaAboutRow">
            <div>
              <h4>本项目能力</h4>
              <p>JWT 鉴权、动态菜单、角色权限、系统配置抽屉、标签页与主题体系，对齐 GVA 交互与视觉。</p>
            </div>
          </div>
          <div className="gvaAboutRow">
            <div>
              <h4>反馈与贡献</h4>
              <p>欢迎对照参考项目继续补齐业务模块；占位菜单可逐步替换为真实页面与接口。</p>
            </div>
          </div>
        </div>
      </AdminCard>
    </AdminPage>
  );
}
