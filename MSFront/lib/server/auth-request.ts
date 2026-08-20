import { NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, verifyAuthToken } from '@/lib/server/auth-token';
import {
  authenticateSystemUser,
  buildAuthSessionUser,
  getSystemUserById,
} from '@/lib/server/system-user-repository';
import { isPathAllowedForRoles } from '@/lib/server/system-casbin-repository';
import { isTrustedMutationOrigin } from '@/lib/server/request-security';
import { RequestBodyError } from '@/lib/server/request-body';
import { disableResponseCaching, privateJson } from '@/lib/server/response-security';
import type { AuthSessionUser } from '@/lib/types/system';

export { AUTH_COOKIE_NAME } from '@/lib/server/auth-token';

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return privateJson({ code: 0, data, msg: 'success' }, init);
}

export function jsonFail(message: string, status = 400) {
  return privateJson({ code: status, data: null, msg: message }, { status });
}

export function jsonApiError(error: unknown, fallbackMessage: string, status = 500) {
  if (error instanceof RequestBodyError) {
    return disableResponseCaching(NextResponse.json(
      {
        code: error.status,
        data: null,
        msg: error.message,
        error: {
          code: error.code,
          issues: error.issues,
        },
      },
      { status: error.status },
    ));
  }
  console.error(fallbackMessage, error);
  return jsonFail(fallbackMessage, status);
}

export function readCookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) {
    return null;
  }

  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return null;
      }
    }
  }

  return null;
}

export async function resolveSessionFromRequest(request: Request): Promise<AuthSessionUser | null> {
  const token = readCookieValue(request.headers.get('cookie'), AUTH_COOKIE_NAME);
  if (!token) {
    return null;
  }

  const payload = await verifyAuthToken(token);
  if (!payload) {
    return null;
  }

  const user = await getSystemUserById(payload.sub);
  if (!user || user.status !== 'active') {
    return null;
  }

  return buildAuthSessionUser(user);
}

export async function requireSession(request: Request) {
  const session = await resolveSessionFromRequest(request);
  if (!session) {
    return { session: null as AuthSessionUser | null, error: jsonFail('未登录或会话已失效', 401) };
  }
  return { session, error: null };
}

export async function requireApiAccess(request: Request, pathOverride?: string) {
  if (!isTrustedMutationOrigin(request)) {
    return {
      session: null as AuthSessionUser | null,
      error: jsonFail('请求来源不受信任', 403),
    };
  }

  const { session, error } = await requireSession(request);
  if (error || !session) {
    return { session: null as AuthSessionUser | null, error: error ?? jsonFail('未登录', 401) };
  }

  const requestUrl = new URL(request.url);
  const path = pathOverride ?? requestUrl.pathname;
  const allowed = await isPathAllowedForRoles(session.roleIds, request.method, path);
  if (!allowed) {
    return { session, error: jsonFail('无接口访问权限', 403) };
  }

  return { session, error: null };
}

export async function loginWithPassword(username: string, password: string) {
  const user = await authenticateSystemUser(username, password);
  if (!user) {
    return null;
  }
  return buildAuthSessionUser(user);
}
