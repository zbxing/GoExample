import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { register } from '@/instrumentation';

const productionSecret = 'msfront-test-jwt-secret-at-least-32-characters';

describe('server startup configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fails before serving when production auth configuration is unsafe', () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MSFRONT_JWT_SECRET', 'replace-this-secret-outside-local-development');

    expect(() => register()).toThrow(/MSFRONT_JWT_SECRET/);
  });

  it('fails before serving when a trusted origin is malformed', () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MSFRONT_JWT_SECRET', productionSecret);
    vi.stubEnv('MSFRONT_TRUSTED_ORIGINS', 'https://console.example.com,not-an-origin');

    expect(() => register()).toThrow(/Origin/);
  });

  it('accepts valid production configuration', () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MSFRONT_JWT_SECRET', productionSecret);
    vi.stubEnv('MSFRONT_TRUSTED_ORIGINS', 'https://console.example.com');

    expect(() => register()).not.toThrow();
  });
});
