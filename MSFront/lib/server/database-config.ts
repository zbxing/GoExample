export interface DatabasePoolOptions {
  max: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  statement_timeout: number;
  query_timeout: number;
}

type EnvironmentValues = Readonly<Record<string, string | undefined>>;

export function resolveDatabasePoolOptions(
  environment: EnvironmentValues = process.env,
): DatabasePoolOptions {
  return {
    max: readBoundedInteger(environment, 'MSFRONT_DB_POOL_MAX', 10, 1, 100),
    connectionTimeoutMillis: readBoundedInteger(
      environment,
      'MSFRONT_DB_CONNECT_TIMEOUT_MS',
      5_000,
      100,
      120_000,
    ),
    idleTimeoutMillis: readBoundedInteger(
      environment,
      'MSFRONT_DB_IDLE_TIMEOUT_MS',
      30_000,
      1_000,
      600_000,
    ),
    statement_timeout: readBoundedInteger(
      environment,
      'MSFRONT_DB_STATEMENT_TIMEOUT_MS',
      15_000,
      100,
      600_000,
    ),
    query_timeout: readBoundedInteger(
      environment,
      'MSFRONT_DB_QUERY_TIMEOUT_MS',
      20_000,
      100,
      600_000,
    ),
  };
}

function readBoundedInteger(
  environment: EnvironmentValues,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const rawValue = `${environment[name] ?? ''}`.trim();

  if (!rawValue) {
    return fallback;
  }

  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }

  const value = Number(rawValue);

  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }

  return value;
}
