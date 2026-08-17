import 'server-only';

export interface ProbePolicyOptions {
  environment?: string;
  primaryBaseUrl?: string;
  allowedOrigins?: string;
}

function parseProbeUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Probe URL must use HTTP or HTTPS.');
  }
  if (url.username || url.password) {
    throw new Error('Probe URL must not contain credentials.');
  }
  if (url.search || url.hash) {
    throw new Error('Probe base URL must not contain a query string or fragment.');
  }
  return url;
}

function configuredOrigins(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => parseProbeUrl(item).origin);
}

export function resolveAllowedProbeBaseUrl(
  baseUrl: string,
  options: ProbePolicyOptions = {},
) {
  const target = parseProbeUrl(baseUrl.trim());
  const environment = options.environment ?? process.env.NODE_ENV ?? 'development';
  if (environment === 'production') {
    const allowed = new Set(configuredOrigins(
      options.allowedOrigins ?? process.env.MSFRONT_PROBE_ALLOWED_ORIGINS ?? '',
    ));
    const primaryBaseUrl = options.primaryBaseUrl ?? process.env.NEXT_PUBLIC_MSFRONT_API_BASE_URL;
    if (primaryBaseUrl?.trim()) {
      allowed.add(parseProbeUrl(primaryBaseUrl.trim()).origin);
    }
    if (!allowed.has(target.origin)) {
      throw new Error(`Probe origin is not allowed in production: ${target.origin}`);
    }
  }

  return target.toString().replace(/\/$/, '');
}
