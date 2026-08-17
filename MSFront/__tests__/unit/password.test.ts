import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  hashPassword,
  needsPasswordRehash,
  verifyPassword,
} from '@/lib/server/password';

describe('password hashing', () => {
  it('creates a versioned strong scrypt hash', async () => {
    const hash = await hashPassword('correct horse battery staple');

    expect(hash).toMatch(/^scrypt\$1\$131072\$8\$1\$/);
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong password', hash)).resolves.toBe(false);
    expect(needsPasswordRehash(hash)).toBe(false);
  });

  it('verifies legacy hashes and marks them for an upgrade', async () => {
    const legacy = 'goexample-demo-salt-v1:59d3e0de6720fa398aaa2a7e971f6ac8bd4a4129ec5856075a287901ac23d2974e44af67600a41c003640494c8275e4efe04e521b835700ebf637a398bc03161';

    await expect(verifyPassword('admin123', legacy)).resolves.toBe(true);
    expect(needsPasswordRehash(legacy)).toBe(true);
    await expect(verifyPassword('admin123', 'invalid')).resolves.toBe(false);
  });
});
