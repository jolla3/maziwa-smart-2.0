/** Approved delegated permission catalog — exact strings only (no wildcards). */
export const PERMISSION_CATALOG = Object.freeze([
  'animals.read',
  'animals.create',
  'animals.update',
  'milk.read',
  'milk.record',
  'milk.update',
  'breeding.read',
  'breeding.record',
  'breeding.update',
  'health.read',
  'health.record',
  'health.update',
  'feed.read',
  'feed.record',
  'feed.update',
  'custom_records.read',
  'custom_records.create',
  'custom_records.update',
  'finance.read',
  'finance.record_income',
  'finance.record_expense',
  'finance.update',
  'analytics.read',
  'marketplace.manage_farmer_ads',
]);

const ALLOWED = new Set(PERMISSION_CATALOG);

export function isApprovedPermission(value) {
  return typeof value === 'string' && ALLOWED.has(value);
}

export function assertPermissionList(permissions) {
  if (!Array.isArray(permissions) || permissions.length === 0) {
    return { ok: false, message: 'At least one permission is required.' };
  }
  const unique = [...new Set(permissions.map((p) => String(p).trim()))];
  for (const p of unique) {
    if (!isApprovedPermission(p)) {
      return { ok: false, message: `Permission not in approved catalog: ${p}` };
    }
  }
  return { ok: true, permissions: unique };
}
