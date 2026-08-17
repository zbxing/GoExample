import { describe, expect, it } from 'vitest';
import { resolveDatabasePoolOptions } from '@/lib/server/database-config';

describe('database pool configuration', () => {
  it('uses bounded production-safe defaults', () => {
    expect(resolveDatabasePoolOptions({})).toEqual({
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 15_000,
      query_timeout: 20_000,
    });
  });

  it('accepts explicit integer overrides', () => {
    expect(
      resolveDatabasePoolOptions({
        MSFRONT_DB_POOL_MAX: '24',
        MSFRONT_DB_CONNECT_TIMEOUT_MS: '1200',
        MSFRONT_DB_IDLE_TIMEOUT_MS: '45000',
        MSFRONT_DB_STATEMENT_TIMEOUT_MS: '8000',
        MSFRONT_DB_QUERY_TIMEOUT_MS: '9000',
      }),
    ).toEqual({
      max: 24,
      connectionTimeoutMillis: 1_200,
      idleTimeoutMillis: 45_000,
      statement_timeout: 8_000,
      query_timeout: 9_000,
    });
  });

  it.each([
    ['MSFRONT_DB_POOL_MAX', '0'],
    ['MSFRONT_DB_POOL_MAX', '1.5'],
    ['MSFRONT_DB_CONNECT_TIMEOUT_MS', '10'],
    ['MSFRONT_DB_IDLE_TIMEOUT_MS', 'infinite'],
  ])('rejects invalid %s values', (name, value) => {
    expect(() => resolveDatabasePoolOptions({ [name]: value })).toThrow(name);
  });
});
