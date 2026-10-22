import { normalizeOrigin, getAllowedOrigins, isAllowedOrigin } from '../../src/config/security.js';

describe('origin security configuration', () => {
  test('normalizes trailing slashes and whitespace', () => {
    expect(normalizeOrigin('  https://example.test///  ')).toBe('https://example.test');
  });

  test('uses configured frontend origins as an explicit allowlist', () => {
    expect(getAllowedOrigins()).toEqual(['http://localhost:5173', 'https://example.test']);
    expect(isAllowedOrigin('https://example.test')).toBe(true);
    expect(isAllowedOrigin('https://attacker.test')).toBe(false);
    expect(isAllowedOrigin(undefined)).toBe(false);
  });
});
