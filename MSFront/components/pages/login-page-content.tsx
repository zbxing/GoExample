'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { Eye, EyeOff, Moon, Sun, UserRound } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import type { AuthSessionUser } from '@/lib/types/system';
import { BottomInfo } from '@/components/shell/bottom-info';
import { applyTheme, useTheme } from '@/providers/theme-provider';
import {
  readFnaShellSettings,
  writeFnaShellSettings,
} from '@/lib/utils/fna-shell-settings';

export function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { theme, setTheme } = useTheme();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** 仅客户端挂载后切换日月图标，避免 SSR/水合不一致 */
  const [themeIconReady, setThemeIconReady] = useState(false);
  const isDark = themeIconReady && theme === 'graphite';

  useEffect(() => {
    setThemeIconReady(true);
  }, []);

  function toggleTheme() {
    const nextDark = !isDark;
    const nextTheme = nextDark ? 'graphite' : 'fna';
    applyTheme(nextTheme);
    setTheme(nextTheme);
    writeFnaShellSettings({
      ...readFnaShellSettings(),
      themeScheme: nextDark ? 'dark' : 'light',
    });
  }

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
    <div id="userLayout" className="fnaUserLayout">
      <button
        type="button"
        className="fnaLoginThemeToggle"
        onClick={toggleTheme}
        aria-label={isDark ? '切换为白天主题' : '切换为夜间主题'}
        title={isDark ? '白天主题' : '夜间主题'}
      >
        {isDark ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      <div className="fnaLoginBanner banner-oblique" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="fnaLoginCoverImg" src="/fna-cover.svg" alt="" />
      </div>

      <div className="fnaLoginLeft">
        <div className="fnaLoginCard">
          <div className="fnaEntryBrand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/fna-logo.png" alt="" className="fnaEntryLogo" />
            <p className="fnaEntryTitle">FNA</p>
          </div>

          <form
            className="fnaLoginForm"
            onSubmit={(event) => {
              void handleSubmit(event);
            }}
          >
            <div className="fnaLoginFormItem">
              <label className="srOnly" htmlFor="login-username">
                用户名
              </label>
              <div className="fnaElInput fnaElInputLarge">
                <input
                  id="login-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  placeholder="请输入用户名"
                />
                <span className="fnaElInputSuffix">
                  <UserRound size={16} />
                </span>
              </div>
            </div>

            <div className="fnaLoginFormItem">
              <label className="srOnly" htmlFor="login-password">
                密码
              </label>
              <div className="fnaElInput fnaElInputLarge">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="请输入密码"
                />
                <button
                  type="button"
                  className="fnaElInputSuffix fnaElInputSuffixBtn"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error ? <p className="fnaLoginError" role="alert">{error}</p> : null}
            {info ? <p className="fnaLoginInfo" role="status">{info}</p> : null}

            <div className="fnaLoginFormItem">
              <button
                type="submit"
                className="fnaBtnPrimary fnaBtnLarge fnaBtnBlock"
                disabled={isSubmitting}
              >
                {isSubmitting ? '登录中…' : '登 录'}
              </button>
            </div>

            <div className="fnaLoginFormItem">
              <button
                type="button"
                className="fnaBtnHollow fnaBtnLarge fnaBtnBlock"
                onClick={() => setInfo('已配置数据库信息，无法初始化')}
              >
                前往初始化
              </button>
            </div>
          </form>

          <BottomInfo className="login-footer fnaLoginFooter" />
        </div>
      </div>
    </div>
  );
}
