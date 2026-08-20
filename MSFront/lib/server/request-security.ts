import 'server-only';
import {
  normalizeHttpOrigin,
  parseTrustedMutationOrigins,
  validateTrustedMutationOrigins,
} from '@/lib/server/runtime-config';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export { validateTrustedMutationOrigins };

export function isTrustedMutationOrigin(
  request: Request,
  trustedOrigins = process.env.MSFRONT_TRUSTED_ORIGINS ?? '',
) {
  if (safeMethods.has(request.method.toUpperCase())) {
    return true;
  }

  const originHeader = request.headers.get('origin');
  if (!originHeader || originHeader === 'null') {
    return false;
  }

  try {
    const origin = normalizeHttpOrigin(originHeader);
    const requestOrigin = normalizeHttpOrigin(request.url);
    return origin === requestOrigin || parseTrustedMutationOrigins(trustedOrigins).includes(origin);
  } catch {
    return false;
  }
}
