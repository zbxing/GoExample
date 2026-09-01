'use client';

import { AdminCard, AdminPage } from '@/components/admin/admin-primitives';

export function AboutPage() {
  return (
    <AdminPage>
      <AdminCard>
        <div className="fnaAboutPage">
          <div className="fnaAboutRow">
            <img src="/fna-logo.png" alt="" className="fnaAboutLogo" />
            <div>
              <h4>FNA / MSFront</h4>
              <p>Fiber + Next + Admin 管理台示例，聚焦权限、菜单与运维能力；交互与视觉参考 gin-vue-admin。</p>
              <div className="fnaAboutLinks">
                <a href="https://www.gin-vue-admin.com" target="_blank" rel="noreferrer">
                  参考文档
                </a>
                <span>·</span>
                <a href="https://github.com/flipped-aurora/gin-vue-admin" target="_blank" rel="noreferrer">
                  参考仓库
                </a>
                <span>·</span>
                <a href="http://demo.gin-vue-admin.com" target="_blank" rel="noreferrer">
                  参考演示
                </a>
              </div>
            </div>
          </div>
          <div className="fnaAboutRow">
            <div>
              <h4>本项目能力</h4>
              <p>JWT 鉴权、动态菜单、角色权限、系统配置抽屉、标签页与主题体系，对齐 gin-vue-admin 交互与视觉。</p>
            </div>
          </div>
          <div className="fnaAboutRow">
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
