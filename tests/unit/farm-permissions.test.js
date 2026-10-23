import { PERMISSION_CATALOG, isApprovedPermission, assertPermissionList } from '../../src/modules/farm-access/permissions.js';

describe('farm-access permission catalog', () => {
  test('contains exact animal and milk permissions without wildcards', () => {
    expect(PERMISSION_CATALOG).toContain('animals.read');
    expect(PERMISSION_CATALOG).toContain('animals.create');
    expect(PERMISSION_CATALOG).toContain('milk.record');
    expect(PERMISSION_CATALOG.some((p) => p.includes('*'))).toBe(false);
  });

  test('rejects unknown and wildcard permissions', () => {
    expect(isApprovedPermission('animals.*')).toBe(false);
    expect(isApprovedPermission('animals.delete')).toBe(false);
    expect(assertPermissionList(['animals.read']).ok).toBe(true);
    expect(assertPermissionList(['animals.*']).ok).toBe(false);
  });
});
