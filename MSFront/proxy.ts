import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_COOKIE_NAME, buildClearAuthCookie, verifyAuthToken } from '@/lib/server/auth-token';
import { getSystemUserById } from '@/lib/server/system-user-repository';
import { disableResponseCaching } from '@/lib/server/response-security';

const publicPagePaths = new Set(['/login']);
const publicApiPaths = new Set(['/api/auth/login']);

async function resolveProxyAuth(request: NextRequest) {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value ?? null;
  if (!token) {
    return { isAuthenticated: false, shouldClearCookie: false };
  }

  const payload = await verifyAuthToken(token);
  if (!payload) {
    return { isAuthenticated: false, shouldClearCookie: true };
  }

  const user = await getSystemUserById(payload.sub);
  if (!user || user.status !== 'active') {
    return { isAuthenticated: false, shouldClearCookie: true };
  }

  return { isAuthenticated: true, shouldClearCookie: false };
}

function withClearedAuthCookie<T extends Response>(response: T, shouldClearCookie: boolean) {
  if (shouldClearCookie) {
    response.headers.set('Set-Cookie', buildClearAuthCookie());
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  const { isAuthenticated, shouldClearCookie } = await resolveProxyAuth(request);

  if (pathname.startsWith('/api/')) {
    if (publicApiPaths.has(pathname)) {
      return NextResponse.next();
    }

    if (!isAuthenticated) {
      return withClearedAuthCookie(
        disableResponseCaching(
          NextResponse.json(
            { code: 401, data: null, msg: '未登录或会话已失效' },
            { status: 401 },
          ),
        ),
        shouldClearCookie,
      );
    }

    return NextResponse.next();
  }

  if (publicPagePaths.has(pathname)) {
    if (isAuthenticated && pathname === '/login') {
      return disableResponseCaching(NextResponse.redirect(new URL('/dashboard', request.url)));
    }
    return withClearedAuthCookie(NextResponse.next(), shouldClearCookie);
  }

  if (!isAuthenticated) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return withClearedAuthCookie(
      disableResponseCaching(NextResponse.redirect(loginUrl)),
      shouldClearCookie,
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
