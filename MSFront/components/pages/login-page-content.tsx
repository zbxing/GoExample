'use client';

import { FormEvent, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { Eye, EyeOff, UserRound } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import type { AuthSessionUser } from '@/lib/types/system';
import { BottomInfo } from '@/components/shell/bottom-info';

export function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event?: FormEvent) {
    event?.preventDefault();
    setError('');
    setInfo('');

    if (username.trim().length < 5) {
      setError('请输入正确的用户名');
      return;
    }
    if (password.length < 6) {
      setError('请输入正确的密码');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await apiFetch<{ user: AuthSessionUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      const redirect = searchParams.get('redirect') || result.data.user.defaultRouter || '/dashboard';
      router.replace(redirect as Route);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div id="userLayout" className="gvaUserLayout">
      <div className="gvaLoginBanner banner-oblique" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="gvaLoginCoverImg" src="/gva-cover.svg" alt="" />
      </div>

      <div className="gvaLoginLeft">
        <div className="gvaLoginCard">
          <div className="gvaEntryBrand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/gva-logo.png" alt="" className="gvaEntryLogo" />
            <p className="gvaEntryTitle">Gin-Vue-Admin</p>
          </div>

          <form
            className="gvaLoginForm"
            onSubmit={(event) => {
              void handleSubmit(event);
            }}
          >
            <div className="gvaLoginFormItem">
              <div className="gvaElInput gvaElInputLarge">
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  placeholder="请输入用户名"
                />
                <span className="gvaElInputSuffix">
                  <UserRound size={16} />
                </span>
              </div>
            </div>

            <div className="gvaLoginFormItem">
              <div className="gvaElInput gvaElInputLarge">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="请输入密码"
                />
                <button
                  type="button"
                  className="gvaElInputSuffix gvaElInputSuffixBtn"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error ? <p className="gvaLoginError">{error}</p> : null}
            {info ? <p className="gvaLoginInfo">{info}</p> : null}

            <div className="gvaLoginFormItem">
              <button
                type="submit"
                className="gvaBtnPrimary gvaBtnLarge gvaBtnBlock"
                disabled={isSubmitting}
              >
                {isSubmitting ? '登录中…' : '登 录'}
              </button>
            </div>

            <div className="gvaLoginFormItem">
              <button
                type="button"
                className="gvaBtnHollow gvaBtnLarge gvaBtnBlock"
                onClick={() => setInfo('已配置数据库信息，无法初始化')}
              >
                前往初始化
              </button>
            </div>
          </form>

          <BottomInfo className="login-footer gvaLoginFooter" />
        </div>
      </div>
    </div>
  );
}
