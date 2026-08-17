import { describe, expect, it } from 'vitest';
import {
  buildRolesHref,
  buildUsersHref,
  resolveRolesFilterState,
  resolveUsersFilterState,
} from '@/lib/utils/access-filters';
import { humanizeIdentifier, joinDetails } from '@/lib/utils/format';
import { collectLeafPaths, flattenMenuTree } from '@/lib/utils/menu-access';

describe('access filter URLs', () => {
  it('normalizes invalid filters and trims search text', () => {
    expect(resolveUsersFilterState(
      { userId: 'missing', roleId: 'ops', status: 'unknown', search: '  api  ' },
      ['u-1'],
      ['ops'],
    )).toEqual({ userId: '', roleId: 'ops', status: 'all', search: 'api' });

    expect(resolveRolesFilterState(
      { roleId: 'missing', userId: 'u-1', search: '  admin ' },
      ['ops'],
      ['u-1'],
    )).toEqual({ roleId: '', userId: 'u-1', search: 'admin' });
  });

  it('omits default values and encodes non-default filters', () => {
    expect(buildUsersHref()).toBe('/users');
    expect(buildUsersHref({ roleId: 'ops', status: 'disabled', search: 'api admin' }))
      .toBe('/users?roleId=ops&status=disabled&search=api+admin');
    expect(buildRolesHref({ roleId: 'ops', userId: 'u-1' }))
      .toBe('/roles?roleId=ops&userId=u-1');
  });
});

describe('presentation utilities', () => {
  it('joins only meaningful details and humanizes identifiers', () => {
    expect(joinDetails([' API ', null, 3, ''])).toBe('API / 3');
    expect(humanizeIdentifier('project:read-only_v2')).toBe('project read only v2');
  });

  it('flattens menu trees and collects only valid leaf paths', () => {
    const menus = [
      {
        id: 'root',
        path: '/root',
        children: [
          { id: 'dashboard', path: '/dashboard', children: [] },
          { id: 'external', path: 'https://example.com', children: [] },
        ],
      },
    ] as never[];

    expect(flattenMenuTree(menus).map((menu) => menu.id)).toEqual([
      'root',
      'dashboard',
      'external',
    ]);
    expect([...collectLeafPaths(menus)]).toEqual(['/dashboard']);
  });
});
