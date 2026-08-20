import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isTrustedMutationOrigin: vi.fn(),
}));

vi.mock('@/lib/server/request-security', () => ({
  isTrustedMutationOrigin: mocks.isTrustedMutationOrigin,
}));

vi.mock('@/lib/server/auth-token', () => ({
  buildClearAuthCookie: () => 'msfront_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
}));

vi.mock('@/lib/server/auth-request', () => ({
  jsonFail: (message: string, status: number) =>
    Response.json({ code: status, data: null, msg: message }, { status }),
  jsonOk: <T>(data: T) => Response.json({ code: 0, data, msg: 'success' }),
}));

vi.mock('@/lib/server/response-security', () => ({
  disableResponseCaching: <T extends Response>(response: T) => {
    response.headers.set('Cache-Control', 'no-store, no-transform');
    response.headers.set('Pragma', 'no-cache');
    return response;
  },
}));

import { POST } from '@/app/api/auth/logout/route';

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    mocks.isTrustedMutationOrigin.mockReset();
  });

  it('rejects an untrusted mutation origin without clearing the cookie', async () => {
    mocks.isTrustedMutationOrigin.mockReturnValue(false);

    const response = await POST(new Request('https://console.example.com/api/auth/logout', {
      method: 'POST',
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store, no-transform');
    expect(response.headers.get('pragma')).toBe('no-cache');
  });

  it('clears the session cookie and disables caching for a trusted origin', async () => {
    mocks.isTrustedMutationOrigin.mockReturnValue(true);

    const response = await POST(new Request('https://console.example.com/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'https://console.example.com' },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(response.headers.get('cache-control')).toBe('no-store, no-transform');
    expect(response.headers.get('pragma')).toBe('no-cache');
  });
});
