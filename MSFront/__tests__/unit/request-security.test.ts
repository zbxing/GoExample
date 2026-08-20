import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  isTrustedMutationOrigin,
  validateTrustedMutationOrigins,
} from '@/lib/server/request-security';
import { disableResponseCaching, privateJson } from '@/lib/server/response-security';

describe('disableResponseCaching', () => {
  it('sets shared-store and legacy proxy cache prevention headers', () => {
    const response = disableResponseCaching(Response.json({ ok: true }));

    expect(response.headers.get('cache-control')).toBe('no-store, no-transform');
    expect(response.headers.get('pragma')).toBe('no-cache');
  });

  it('creates private JSON responses with the shared cache policy', async () => {
    const response = privateJson({ ok: true }, { status: 202 });

    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toBe('no-store, no-transform');
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe('isTrustedMutationOrigin', () => {
  it('does not require Origin for safe methods', () => {
    expect(isTrustedMutationOrigin(new Request('https://console.example.com/api/items'))).toBe(true);
  });

  it('accepts same-origin and explicitly trusted mutation origins', () => {
    const sameOrigin = new Request('https://console.example.com/api/items', {
      method: 'POST',
      headers: { origin: 'https://console.example.com' },
    });
    const trustedProxy = new Request('http://internal:3000/api/items', {
      method: 'PATCH',
      headers: { origin: 'https://console.example.com' },
    });

    expect(isTrustedMutationOrigin(sameOrigin)).toBe(true);
    expect(isTrustedMutationOrigin(trustedProxy, 'https://console.example.com')).toBe(true);
  });

  it('rejects missing, null, malformed, and cross-origin mutation requests', () => {
    const options = { method: 'DELETE' };
    expect(isTrustedMutationOrigin(new Request('https://console.example.com/api/items', options)))
      .toBe(false);
    expect(isTrustedMutationOrigin(new Request('https://console.example.com/api/items', {
      ...options,
      headers: { origin: 'null' },
    }))).toBe(false);
    expect(isTrustedMutationOrigin(new Request('https://console.example.com/api/items', {
      ...options,
      headers: { origin: 'https://attacker.example' },
    }))).toBe(false);
  });
});

describe('validateTrustedMutationOrigins', () => {
  it('rejects malformed configured origins before serving requests', () => {
    expect(() => validateTrustedMutationOrigins('https://console.example.com,not-an-origin'))
      .toThrow();
  });

  it('accepts HTTP(S) origins without credentials', () => {
    expect(() => validateTrustedMutationOrigins('https://console.example.com,http://internal:3000'))
      .not.toThrow();
  });
});
