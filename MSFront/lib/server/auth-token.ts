import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import type { AuthTokenPayload } from '@/lib/types/system';

export const AUTH_COOKIE_NAME = 'msfront_token';

const tokenIssuer = 'msfront';
const tokenAudience = 'msfront-admin';
const tokenTtl = '12h';
const developmentSecret = 'msfront-dev-jwt-secret-change-me';
const rejectedProductionSecrets = new Set([
  developmentSecret,
  'replace-this-secret-outside-local-development',
]);

function getJwtSecret() {
  const configuredSecret = process.env.MSFRONT_JWT_SECRET?.trim() ?? '';
  if (
    process.env.NODE_ENV === 'production' &&
    (configuredSecret.length < 32 || rejectedProductionSecrets.has(configuredSecret))
  ) {
    throw new Error(
      'MSFRONT_JWT_SECRET must be a non-default value with at least 32 characters in production.',
    );
  }
  const secret = configuredSecret || developmentSecret;
  return new TextEncoder().encode(secret);
}

export async function signAuthToken(payload: AuthTokenPayload) {
  return new SignJWT({
    username: payload.username,
    roleIds: payload.roleIds,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuer(tokenIssuer)
    .setAudience(tokenAudience)
    .setIssuedAt()
    .setExpirationTime(tokenTtl)
    .sign(getJwtSecret());
}

export async function verifyAuthToken(token: string): Promise<AuthTokenPayload | null> {
  try {
    const result = await jwtVerify(token, getJwtSecret(), {
      algorithms: ['HS256'],
      issuer: tokenIssuer,
      audience: tokenAudience,
    });

    const sub = result.payload.sub;
    const username = result.payload.username;
    const roleIds = result.payload.roleIds;

    if (typeof sub !== 'string' || typeof username !== 'string' || !Array.isArray(roleIds)) {
      return null;
    }

    return {
      sub,
      username,
      roleIds: roleIds.filter((item): item is string => typeof item === 'string'),
    };
  } catch {
    return null;
  }
}

export function buildAuthCookie(token: string) {
  const secure = process.env.NODE_ENV === 'production';
  return `${AUTH_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 12}${secure ? '; Secure' : ''}`;
}

export function buildClearAuthCookie() {
  const secure = process.env.NODE_ENV === 'production';
  return `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}
