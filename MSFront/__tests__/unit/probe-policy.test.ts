import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { resolveAllowedProbeBaseUrl } from '@/lib/server/probe-policy';

describe('probe URL policy', () => {
  it('accepts and normalizes HTTP(S) URLs in development', () => {
    expect(resolveAllowedProbeBaseUrl('http://127.0.0.1:3001/', {
      environment: 'development',
    })).toBe('http://127.0.0.1:3001');
  });

  it('rejects unsafe protocols, credentials, query strings, and fragments', () => {
    expect(() => resolveAllowedProbeBaseUrl('file:///etc/passwd')).toThrow(/HTTP or HTTPS/);
    expect(() => resolveAllowedProbeBaseUrl('https://user:pass@example.com')).toThrow(/credentials/);
    expect(() => resolveAllowedProbeBaseUrl('https://example.com?target=internal')).toThrow(/query/);
    expect(() => resolveAllowedProbeBaseUrl('https://example.com/#internal')).toThrow(/fragment/);
  });

  it('requires an explicit production origin allowlist', () => {
    expect(resolveAllowedProbeBaseUrl('https://api.example.com', {
      environment: 'production',
      primaryBaseUrl: 'https://api.example.com',
    })).toBe('https://api.example.com');
    expect(resolveAllowedProbeBaseUrl('https://probe.example.com', {
      environment: 'production',
      allowedOrigins: 'https://probe.example.com',
    })).toBe('https://probe.example.com');
    expect(() => resolveAllowedProbeBaseUrl('https://metadata.internal', {
      environment: 'production',
      primaryBaseUrl: 'https://api.example.com',
    })).toThrow(/not allowed/);
  });
});
