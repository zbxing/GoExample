import 'server-only';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

function normalizeOrigin(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Origin must be an HTTP(S) origin without credentials.');
  }
  return url.origin;
}

function configuredOrigins(rawValue: string) {
  return rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeOrigin);
}

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
    const origin = normalizeOrigin(originHeader);
    const requestOrigin = normalizeOrigin(request.url);
    return origin === requestOrigin || configuredOrigins(trustedOrigins).includes(origin);
  } catch {
    return false;
  }
}
