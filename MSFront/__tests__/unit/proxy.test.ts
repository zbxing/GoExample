import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  getSystemUserById: vi.fn(),
  buildClearAuthCookie: vi.fn(() => 'msfront_token=; Path=/; Max-Age=0'),
}));

vi.mock('@/lib/server/auth-token', () => ({
  AUTH_COOKIE_NAME: 'msfront_token',
  verifyAuthToken: mocks.verifyAuthToken,
  buildClearAuthCookie: mocks.buildClearAuthCookie,
}));

vi.mock('@/lib/server/system-user-repository', () => ({
  getSystemUserById: mocks.getSystemUserById,
}));

vi.mock('@/lib/server/response-security', () => ({
  disableResponseCaching: <T extends Response>(response: T) => {
    response.headers.set('Cache-Control', 'no-store, no-transform');
    response.headers.set('Pragma', 'no-cache');
    return response;
  },
}));

import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

function request(url: string, token?: string) {
  return new NextRequest(`https://console.example.com${url}`, token
    ? { headers: { cookie: `msfront_token=${token}` } }
    : undefined);
}

describe('proxy session redirects', () => {
  beforeEach(() => {
    mocks.verifyAuthToken.mockReset();
    mocks.getSystemUserById.mockReset();
    mocks.buildClearAuthCookie.mockClear();
    mocks.verifyAuthToken.mockResolvedValue(null);
    mocks.getSystemUserById.mockResolvedValue(null);
  });

  it('does not cache anonymous protected-page redirects', async () => {
    const response = await proxy(request('/projects'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://console.example.com/login?redirect=%2Fprojects',
    );
    expect(response.headers.get('cache-control')).toBe('no-store, no-transform');
    expect(response.headers.get('pragma')).toBe('no-cache');
  });

  it('does not cache authenticated login-page redirects', async () => {
    mocks.verifyAuthToken.mockResolvedValue({ sub: 'u-1' });
    mocks.getSystemUserById.mockResolvedValue({ id: 'u-1', status: 'active' });

    const response = await proxy(request('/login', 'signed-token'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://console.example.com/dashboard');
    expect(response.headers.get('cache-control')).toBe('no-store, no-transform');
    expect(response.headers.get('pragma')).toBe('no-cache');
  });

  it('clears cookie and redirects when token user is disabled', async () => {
    mocks.verifyAuthToken.mockResolvedValue({ sub: 'u-1' });
    mocks.getSystemUserById.mockResolvedValue({ id: 'u-1', status: 'disabled' });

    const response = await proxy(request('/dashboard', 'signed-token'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://console.example.com/login?redirect=%2Fdashboard',
    );
    expect(response.headers.get('set-cookie')).toContain('msfront_token=');
  });
});
