import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import {
  resolveAuthTokenSecret,
  validateAuthTokenConfiguration,
} from '@/lib/server/runtime-config';
import type { AuthTokenPayload } from '@/lib/types/system';

export const AUTH_COOKIE_NAME = 'msfront_token';

const tokenIssuer = 'msfront';
const tokenAudience = 'msfront-admin';
const tokenTtl = '12h';
const maxSubjectLength = 128;
const maxUsernameLength = 128;
const maxRoleCount = 100;
const maxRoleIdLength = 128;

function isBoundedNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function getJwtSecret() {
  return new TextEncoder().encode(resolveAuthTokenSecret());
}

export { validateAuthTokenConfiguration };

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
      requiredClaims: ['sub', 'iat', 'exp'],
      maxTokenAge: tokenTtl,
    });

    const sub = result.payload.sub;
    const username = result.payload.username;
    const roleIds = result.payload.roleIds;

    if (
      !isBoundedNonEmptyString(sub, maxSubjectLength) ||
      !isBoundedNonEmptyString(username, maxUsernameLength) ||
      !Array.isArray(roleIds) ||
      roleIds.length < 1 ||
      roleIds.length > maxRoleCount ||
      !roleIds.every((roleId) => isBoundedNonEmptyString(roleId, maxRoleIdLength))
    ) {
      return null;
    }

    return {
      sub,
      username,
      roleIds,
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
