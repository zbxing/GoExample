import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { isTrustedMutationOrigin } from '@/lib/server/request-security';

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
