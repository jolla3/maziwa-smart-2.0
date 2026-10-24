import crypto from 'node:crypto';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FARMER_CODE_PATTERN = /^\d{8}$/;
const GOOGLE_SIGNUP_ROLES = new Set(['buyer', 'seller', 'farmer']);

export class IdentityError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'IdentityError';
    this.status = status;
    this.code = code;
  }
}

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isValidEmail(value) {
  return typeof value === 'string' && EMAIL_PATTERN.test(normalizeEmail(value));
}

export function isValidPassword(value, minLength = 6) {
  return typeof value === 'string' && value.length >= minLength;
}


export function oauthStateMatches(supplied, expected) {
  if (typeof supplied !== 'string' || typeof expected !== 'string' || !supplied || !expected) return false;
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (suppliedBytes.length !== expectedBytes.length) return false;
  return crypto.timingSafeEqual(suppliedBytes, expectedBytes);
}

export function normalizeGoogleSignupRole(value) {
  // Explicit role required — do not silently default to buyer (profile-creation policy unresolved).
  if (typeof value !== 'string' || !value.trim()) return null;
  const role = value.trim().toLowerCase();
  return GOOGLE_SIGNUP_ROLES.has(role) ? role : null;
}

export function normalizeFarmerCode(value) {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!FARMER_CODE_PATTERN.test(raw)) return null;
  const code = Number(raw);
  return code >= 10_000_000 && code <= 99_999_999 ? code : null;
}

export function assertEmail(value) {
  const email = normalizeEmail(value);
  if (!isValidEmail(email)) {
    throw new IdentityError(400, 'INVALID_EMAIL', 'A valid email address is required.');
  }
  return email;
}

export function assertPassword(value, minLength = 6) {
  if (!isValidPassword(value, minLength)) {
    throw new IdentityError(400, 'WEAK_PASSWORD', `Password must be at least ${minLength} characters long.`);
  }
  return value;
}
