import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readJsonFile: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server/json-store', () => ({
  createId: vi.fn(),
  readJsonFile: mocks.readJsonFile,
  writeJsonFile: vi.fn(),
}));

import { isPathAllowedForRoles } from '@/lib/server/system-casbin-repository';

describe('isPathAllowedForRoles', () => {
  beforeEach(() => {
    mocks.readJsonFile.mockResolvedValue({
      policies: [
        {
          id: 'p-read-project',
          roleId: 'ops',
          path: '/api/management/projects/:projectId',
          method: 'GET',
        },
      ],
    });
  });

  it('matches a dynamic path segment for the configured method', async () => {
    await expect(isPathAllowedForRoles(
      ['ops'],
      'GET',
      '/api/management/projects/project-1',
    )).resolves.toBe(true);
  });

  it('does not grant a write method from a read policy', async () => {
    await expect(isPathAllowedForRoles(
      ['ops'],
      'DELETE',
      '/api/management/projects/project-1',
    )).resolves.toBe(false);
  });

  it('preserves the super administrator bypass', async () => {
    await expect(isPathAllowedForRoles(
      ['888'],
      'DELETE',
      '/api/management/projects/project-1',
    )).resolves.toBe(true);
    expect(mocks.readJsonFile).not.toHaveBeenCalled();
  });
});
