import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_COOKIE_NAME, verifyAuthToken } from '@/lib/server/auth-token';

const publicPagePaths = new Set(['/login']);
const publicApiPaths = new Set(['/api/auth/login']);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value ?? null;
  const payload = token ? await verifyAuthToken(token) : null;
  const isAuthenticated = Boolean(payload);

  if (pathname.startsWith('/api/')) {
    if (publicApiPaths.has(pathname)) {
      return NextResponse.next();
    }

    if (!isAuthenticated) {
      return NextResponse.json({ code: 401, data: null, msg: '未登录或会话已失效' }, { status: 401 });
    }

    return NextResponse.next();
  }

  if (publicPagePaths.has(pathname)) {
    if (isAuthenticated && pathname === '/login') {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return NextResponse.next();
  }

  if (!isAuthenticated) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
