import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildAuthSessionUser: vi.fn(),
  getSystemUserById: vi.fn(),
  isPathAllowedForRoles: vi.fn(),
  verifyAuthToken: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server/auth-token', () => ({
  AUTH_COOKIE_NAME: 'msfront_session',
  verifyAuthToken: mocks.verifyAuthToken,
}));
vi.mock('@/lib/server/system-user-repository', () => ({
  authenticateSystemUser: vi.fn(),
  buildAuthSessionUser: mocks.buildAuthSessionUser,
  getSystemUserById: mocks.getSystemUserById,
}));
vi.mock('@/lib/server/system-casbin-repository', () => ({
  isPathAllowedForRoles: mocks.isPathAllowedForRoles,
}));

import { readCookieValue, requireApiAccess } from '@/lib/server/auth-request';

describe('readCookieValue', () => {
  it('reads and decodes a named cookie', () => {
    expect(readCookieValue('theme=dark; msfront_session=a%2Fb%3D; locale=zh-CN', 'msfront_session'))
      .toBe('a/b=');
  });

  it('returns null for a missing cookie', () => {
    expect(readCookieValue(null, 'msfront_session')).toBeNull();
    expect(readCookieValue('theme=dark', 'msfront_session')).toBeNull();
  });

  it('treats malformed cookie encoding as an invalid cookie', () => {
    expect(readCookieValue('msfront_session=%E0%A4%A', 'msfront_session')).toBeNull();
  });
});

describe('requireApiAccess', () => {
  beforeEach(() => {
    mocks.verifyAuthToken.mockResolvedValue({ sub: 'u-1' });
    mocks.getSystemUserById.mockResolvedValue({ id: 'u-1', status: 'active' });
    mocks.buildAuthSessionUser.mockReturnValue({ id: 'u-1', roleIds: ['ops'] });
  });

  it('returns 401 when the session cookie is missing', async () => {
    const result = await requireApiAccess(new Request('http://localhost/api/management/overview'));

    expect(result.session).toBeNull();
    expect(result.error?.status).toBe(401);
    expect(await result.error?.json()).toMatchObject({ code: 401 });
    expect(mocks.isPathAllowedForRoles).not.toHaveBeenCalled();
  });

  it('returns 403 when the role has no matching API policy', async () => {
    mocks.isPathAllowedForRoles.mockResolvedValue(false);
    const request = new Request('http://localhost/api/management/projects/project-1', {
      method: 'DELETE',
      headers: {
        cookie: 'msfront_session=valid-token',
        origin: 'http://localhost',
      },
    });

    const result = await requireApiAccess(request);

    expect(result.session).toMatchObject({ id: 'u-1', roleIds: ['ops'] });
    expect(result.error?.status).toBe(403);
    expect(mocks.isPathAllowedForRoles).toHaveBeenCalledWith(
      ['ops'],
      'DELETE',
      '/api/management/projects/project-1',
    );
  });

  it('returns the session when the API policy allows the request', async () => {
    mocks.isPathAllowedForRoles.mockResolvedValue(true);
    const request = new Request('http://localhost/api/management/projects?view=summary', {
      headers: { cookie: 'msfront_session=valid-token' },
    });

    const result = await requireApiAccess(request);

    expect(result.error).toBeNull();
    expect(result.session).toMatchObject({ id: 'u-1', roleIds: ['ops'] });
    expect(mocks.isPathAllowedForRoles).toHaveBeenCalledWith(
      ['ops'],
      'GET',
      '/api/management/projects',
    );
  });

  it('rejects a state-changing request without a trusted Origin', async () => {
    const request = new Request('http://localhost/api/management/projects/project-1', {
      method: 'DELETE',
      headers: { cookie: 'msfront_session=valid-token' },
    });

    const result = await requireApiAccess(request);

    expect(result.session).toBeNull();
    expect(result.error?.status).toBe(403);
    expect(mocks.verifyAuthToken).not.toHaveBeenCalled();
  });
});
