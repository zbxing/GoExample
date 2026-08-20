const developmentSecret = 'msfront-dev-jwt-secret-change-me';
const rejectedProductionSecrets = new Set([
  developmentSecret,
  'replace-this-secret-outside-local-development',
]);

export function resolveAuthTokenSecret(environment: NodeJS.ProcessEnv = process.env) {
  const configuredSecret = environment.MSFRONT_JWT_SECRET?.trim() ?? '';
  if (
    environment.NODE_ENV === 'production' &&
    (configuredSecret.length < 32 || rejectedProductionSecrets.has(configuredSecret))
  ) {
    throw new Error(
      'MSFRONT_JWT_SECRET must be a non-default value with at least 32 characters in production.',
    );
  }
  return configuredSecret || developmentSecret;
}

export function validateAuthTokenConfiguration(environment: NodeJS.ProcessEnv = process.env) {
  resolveAuthTokenSecret(environment);
}

export function normalizeHttpOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Origin must be a valid HTTP(S) origin.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Origin must be an HTTP(S) origin without credentials.');
  }
  return url.origin;
}

export function parseTrustedMutationOrigins(rawValue: string) {
  return rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeHttpOrigin);
}

export function validateTrustedMutationOrigins(
  rawValue = process.env.MSFRONT_TRUSTED_ORIGINS ?? '',
) {
  parseTrustedMutationOrigins(rawValue);
}
