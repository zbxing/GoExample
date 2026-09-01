'use client';

import { useState } from 'react';
import {
  AdminField,
  AdminPage,
  AdminSwitch,
  useAdminToast,
} from '@/components/admin/admin-primitives';

type SecurityForm = {
  captchaEnabled: boolean;
  captchaLength: string;
  passwordMinLength: string;
  passwordRequireSpecial: boolean;
  loginFailLimit: string;
  lockMinutes: string;
  tokenExpireHours: string;
  ipRateLimit: string;
};

const INITIAL: SecurityForm = {
  captchaEnabled: true,
  captchaLength: '4',
  passwordMinLength: '6',
  passwordRequireSpecial: false,
  loginFailLimit: '5',
  lockMinutes: '15',
  tokenExpireHours: '24',
  ipRateLimit: '120',
};

export function SystemSecurityPage() {
  const { showSuccess, ToastHost } = useAdminToast();
  const [form, setForm] = useState(INITIAL);

  return (
    <AdminPage>
      <div className="fnaSecuritySections">
        <section className="fnaSecuritySection">
          <h3>验证码</h3>
          <div className="adminForm fnaDialogForm">
            <AdminField label="启用验证码">
              <AdminSwitch
                checked={form.captchaEnabled}
                onChange={(checked) => setForm((c) => ({ ...c, captchaEnabled: checked }))}
              />
            </AdminField>
            <AdminField label="验证码位数">
              <input
                value={form.captchaLength}
                onChange={(event) => setForm((c) => ({ ...c, captchaLength: event.target.value }))}
              />
            </AdminField>
          </div>
        </section>

        <section className="fnaSecuritySection">
          <h3>密码策略</h3>
          <div className="adminForm fnaDialogForm">
            <AdminField label="最小长度">
              <input
                value={form.passwordMinLength}
                onChange={(event) =>
                  setForm((c) => ({ ...c, passwordMinLength: event.target.value }))
                }
              />
            </AdminField>
            <AdminField label="要求特殊字符">
              <AdminSwitch
                checked={form.passwordRequireSpecial}
                onChange={(checked) =>
                  setForm((c) => ({ ...c, passwordRequireSpecial: checked }))
                }
              />
            </AdminField>
          </div>
        </section>

        <section className="fnaSecuritySection">
          <h3>登录防护</h3>
          <div className="adminForm fnaDialogForm">
            <AdminField label="失败锁定次数">
              <input
                value={form.loginFailLimit}
                onChange={(event) => setForm((c) => ({ ...c, loginFailLimit: event.target.value }))}
              />
            </AdminField>
            <AdminField label="锁定时长(分)">
              <input
                value={form.lockMinutes}
                onChange={(event) => setForm((c) => ({ ...c, lockMinutes: event.target.value }))}
              />
            </AdminField>
            <AdminField label="Token 过期(时)">
              <input
                value={form.tokenExpireHours}
                onChange={(event) =>
                  setForm((c) => ({ ...c, tokenExpireHours: event.target.value }))
                }
              />
            </AdminField>
            <AdminField label="IP 限流(次/分)">
              <input
                value={form.ipRateLimit}
                onChange={(event) => setForm((c) => ({ ...c, ipRateLimit: event.target.value }))}
              />
            </AdminField>
          </div>
        </section>

        <div>
          <button
            type="button"
            className="elButton elButtonPrimary"
            onClick={() => showSuccess('安全配置已保存（本地演示）')}
          >
            保存配置
          </button>
        </div>
      </div>
      {ToastHost}
    </AdminPage>
  );
}
