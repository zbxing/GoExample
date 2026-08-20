import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';

vi.mock('server-only', () => ({}));

import {
  signAuthToken,
  validateAuthTokenConfiguration,
  verifyAuthToken,
} from '@/lib/server/auth-token';

const testSecret = 'msfront-test-jwt-secret-at-least-32-characters';
const encodedSecret = new TextEncoder().encode(testSecret);

async function signCustomToken(
  claims: { username?: unknown; roleIds?: unknown },
  issuedAt = Math.floor(Date.now() / 1000),
  expiresAt = issuedAt + 12 * 60 * 60,
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('u-1')
    .setIssuer('msfront')
    .setAudience('msfront-admin')
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(encodedSecret);
}

describe('auth token validation', () => {
  beforeEach(() => {
    vi.stubEnv('MSFRONT_JWT_SECRET', testSecret);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('round-trips a bounded token with required claims', async () => {
    const token = await signAuthToken({
      sub: 'u-1',
      username: 'admin',
      roleIds: ['888'],
    });

    await expect(verifyAuthToken(token)).resolves.toEqual({
      sub: 'u-1',
      username: 'admin',
      roleIds: ['888'],
    });
  });

  it.each([
    { username: 'admin', roleIds: [] },
    { username: 'admin', roleIds: ['888', 42] },
    { username: '', roleIds: ['888'] },
  ])('rejects malformed identity claims: %j', async (claims) => {
    const token = await signCustomToken(claims);

    await expect(verifyAuthToken(token)).resolves.toBeNull();
  });

  it('rejects a token older than the configured session lifetime even with a future expiry', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signCustomToken(
      { username: 'admin', roleIds: ['888'] },
      now - 13 * 60 * 60,
      now + 60 * 60,
    );

    await expect(verifyAuthToken(token)).resolves.toBeNull();
  });

  it('rejects the development secret when production configuration is validated', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MSFRONT_JWT_SECRET', 'msfront-dev-jwt-secret-change-me');

    expect(() => validateAuthTokenConfiguration()).toThrow(/non-default value/);
  });

  it('accepts a bounded production secret', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MSFRONT_JWT_SECRET', testSecret);

    expect(() => validateAuthTokenConfiguration()).not.toThrow();
  });
});
