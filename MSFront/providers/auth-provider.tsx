'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api/client';
import type { AuthSessionUser, SystemMenuTreeNode } from '@/lib/types/system';

interface AuthContextValue {
  user: AuthSessionUser | null;
  menus: SystemMenuTreeNode[];
  isLoading: boolean;
  can: (btn: string) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthSessionUser | null>(null);
  const [menus, setMenus] = useState<SystemMenuTreeNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const hasSessionRef = useRef(false);

  useEffect(() => {
    hasSessionRef.current = user !== null;
  }, [user]);

  const refresh = useCallback(async () => {
    if (pathname === '/login') {
      setUser(null);
      setMenus([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const me = await apiFetch<{ user: AuthSessionUser }>('/api/auth/me', {
        donNotShowLoading: true,
      });
      const menuPayload = await apiFetch<{ menus: SystemMenuTreeNode[] }>(
        '/api/system/menus/async',
        { donNotShowLoading: true },
      );
      setUser(me.data.user);
      setMenus(menuPayload.data.menus);
    } catch {
      setUser(null);
      setMenus([]);
      if (pathname !== '/login') {
        router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
      }
    } finally {
      setIsLoading(false);
    }
  }, [pathname, router]);

  useEffect(() => {
    let cancelled = false;

    async function syncAuth() {
      if (pathname === '/login') {
        if (!cancelled) {
          setUser(null);
          setMenus([]);
          setIsLoading(false);
        }
        return;
      }

      // 已登录后的路由切换只做静默校验，不要 isLoading 卸掉整页（否则掐断离场动画）
      const softRefresh = hasSessionRef.current;
      if (!cancelled && !softRefresh) {
        setIsLoading(true);
      }

      try {
        const me = await apiFetch<{ user: AuthSessionUser }>('/api/auth/me', {
          donNotShowLoading: true,
        });
        const menuPayload = await apiFetch<{ menus: SystemMenuTreeNode[] }>(
          '/api/system/menus/async',
          { donNotShowLoading: true },
        );
        if (cancelled) {
          return;
        }
        setUser(me.data.user);
        setMenus(menuPayload.data.menus);
      } catch {
        if (cancelled) {
          return;
        }
        setUser(null);
        setMenus([]);
        if (pathname !== '/login') {
          router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void syncAuth();
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST', donNotShowLoading: true });
    } finally {
      setUser(null);
      setMenus([]);
      router.replace('/login');
    }
  }, [router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      menus,
      isLoading,
      can(btn) {
        if (!user) {
          return false;
        }
        if (user.roleIds.includes('888')) {
          return true;
        }
        return user.btnAuths.includes(btn);
      },
      refresh,
      logout,
    }),
    [isLoading, logout, menus, refresh, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider.');
  }
  return context;
}

export function Can({
  btn,
  children,
  fallback = null,
}: PropsWithChildren<{ btn: string; fallback?: ReactNode }>) {
  const { can } = useAuth();
  if (!can(btn)) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
}
