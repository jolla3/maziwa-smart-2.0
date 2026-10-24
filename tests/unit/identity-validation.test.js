import {
  assertEmail,
  isValidEmail,
  isValidPassword,
  normalizeEmail,
  normalizeFarmerCode,
  normalizeGoogleSignupRole,
  oauthStateMatches,
  IdentityError,
} from '../../src/modules/identity/validation.js';

describe('identity input validation', () => {
  test('normalizes email addresses consistently', () => {
    expect(normalizeEmail('  Farmer@Example.COM ')).toBe('farmer@example.com');
    expect(isValidEmail('farmer@example.com')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
  });

  test('checks the configured password minimum', () => {
    expect(isValidPassword('123456')).toBe(true);
    expect(isValidPassword('short')).toBe(false);
    expect(isValidPassword('123456', 8)).toBe(false);
    expect(isValidPassword(null)).toBe(false);
  });

  test('allows only supported Google self-registration roles', () => {
    expect(normalizeGoogleSignupRole(undefined)).toBeNull();
    expect(normalizeGoogleSignupRole('FARMER')).toBe('farmer');
    expect(normalizeGoogleSignupRole('seller')).toBe('seller');
    expect(normalizeGoogleSignupRole('superadmin')).toBeNull();
    expect(normalizeGoogleSignupRole('manager')).toBeNull();
  });

  test('checks the OAuth state with a constant-time comparison after length checking', () => {
    expect(oauthStateMatches('a'.repeat(64), 'a'.repeat(64))).toBe(true);
    expect(oauthStateMatches('a'.repeat(64), 'b'.repeat(64))).toBe(false);
    expect(oauthStateMatches('short', 'longer')).toBe(false);
    expect(oauthStateMatches(undefined, 'state')).toBe(false);
  });

  test('accepts only eight-digit farmer codes', () => {
    expect(normalizeFarmerCode('12345678')).toBe(12345678);
    expect(normalizeFarmerCode(12345678)).toBe(12345678);
    expect(normalizeFarmerCode('1234')).toBeNull();
    expect(normalizeFarmerCode('01234567')).toBeNull();
    expect(normalizeFarmerCode('1234567a')).toBeNull();
  });

  test('assertEmail returns normalized values and typed validation errors', () => {
    expect(assertEmail(' OWNER@EXAMPLE.COM ')).toBe('owner@example.com');
    expect(() => assertEmail('bad-email')).toThrow(IdentityError);
  });
});
