import { jest } from '@jest/globals';
import crypto from 'node:crypto';
import {
  oauthStateMatches,
  normalizeGoogleSignupRole,
} from '../../src/modules/identity/validation.js';

const needsPasswordSetup = jest.fn();

jest.unstable_mockModule('../../src/modules/identity/service.js', () => ({
  needsPasswordSetup,
  getProfile: jest.fn(),
  authenticatePassword: jest.fn(),
  publicAccount: jest.fn((a) => ({ id: String(a._id), email: a.email, role: a.role })),
  findOrCreateGoogleAccount: jest.fn(),
  registerBuyer: jest.fn(),
  registerFarmer: jest.fn(),
  registerSeller: jest.fn(),
  requestPasswordReset: jest.fn(),
  resetPassword: jest.fn(),
  completePasswordSetup: jest.fn(),
  updateProfile: jest.fn(),
  getAccountForSession: jest.fn(),
  getActiveAccountRef: jest.fn(),
}));

const {
  makeOAuthState,
  completeGoogleCallback,
  googleFailureRedirect,
} = await import('../../src/modules/identity/controller.js');

describe('Google OAuth state and role validation', () => {
  test('makeOAuthState produces high-entropy hex (64 chars)', () => {
    const a = makeOAuthState();
    const b = makeOAuthState();
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(b).toMatch(/^[a-f0-9]{64}$/);
    expect(a).not.toBe(b);
  });

  test('oauthStateMatches accepts equal values and rejects empty or different lengths', () => {
    const state = crypto.randomBytes(32).toString('hex');
    expect(oauthStateMatches(state, state)).toBe(true);
    expect(oauthStateMatches(state, 'f'.repeat(64))).toBe(false);
    expect(oauthStateMatches('', state)).toBe(false);
    expect(oauthStateMatches(state, '')).toBe(false);
    expect(oauthStateMatches(undefined, state)).toBe(false);
    expect(oauthStateMatches(state, undefined)).toBe(false);
    expect(oauthStateMatches('short', 'longer-value-here')).toBe(false);
  });

  test('normalizeGoogleSignupRole requires an explicit allowed role', () => {
    expect(normalizeGoogleSignupRole('buyer')).toBe('buyer');
    expect(normalizeGoogleSignupRole('Seller')).toBe('seller');
    expect(normalizeGoogleSignupRole('FARMER')).toBe('farmer');
    expect(normalizeGoogleSignupRole(undefined)).toBeNull();
    expect(normalizeGoogleSignupRole('')).toBeNull();
    expect(normalizeGoogleSignupRole('admin')).toBeNull();
    expect(normalizeGoogleSignupRole('manager')).toBeNull();
  });
});

describe('completeGoogleCallback session establishment (mocked provider success)', () => {
  function mockRes() {
    return {
      redirect: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
      clearCookie: jest.fn(),
    };
  }

  function mockReq() {
    return {
      session: {
        regenerate: (cb) => cb(null),
        save: (cb) => cb(null),
        destroy: (cb) => cb(null),
      },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('successful callback establishes server session without JWT in redirect URL', async () => {
    needsPasswordSetup.mockResolvedValue(false);
    const account = {
      _id: 'acc-google-1',
      email: 'g@example.com',
      role: 'buyer',
      sessionVersion: 2,
      isActive: true,
    };
    const req = mockReq();
    const res = mockRes();

    await completeGoogleCallback(req, res, account);

    expect(req.session.userId).toBe('acc-google-1');
    expect(req.session.sessionVersion).toBe(2);
    expect(req.session.pendingAccountId).toBeUndefined();
    expect(res.redirect).toHaveBeenCalledTimes(1);
    const location = res.redirect.mock.calls[0][0];
    expect(location).toMatch(/\/google-callback$/);
    expect(location).not.toMatch(/token|jwt|bearer|password|secret/i);
  });

  test('password-setup path sets pendingAccountId only (not full session auth)', async () => {
    needsPasswordSetup.mockResolvedValue(true);
    const account = {
      _id: 'acc-pending',
      email: 'p@example.com',
      role: 'farmer',
      sessionVersion: 0,
    };
    const req = mockReq();
    const res = mockRes();

    await completeGoogleCallback(req, res, account);

    expect(req.session.pendingAccountId).toBe('acc-pending');
    expect(req.session.userId).toBeUndefined();
    const location = res.redirect.mock.calls[0][0];
    expect(location).toMatch(/\/set-password$/);
    expect(location).not.toMatch(/token|jwt|passwordHash/i);
  });

  test('googleFailureRedirect targets frontend login without leaking secrets', () => {
    const res = mockRes();
    googleFailureRedirect(res);
    expect(res.redirect).toHaveBeenCalledTimes(1);
    const location = res.redirect.mock.calls[0][0];
    expect(location).toMatch(/\/login/);
    expect(location).toMatch(/error=/);
    expect(location).not.toMatch(/token|jwt|client_secret|password/i);
  });
});

describe('OAuth callback state gate (session-bound)', () => {
  test('missing stored session state rejects', () => {
    const supplied = makeOAuthState();
    const stored = undefined;
    const expectedState = typeof stored?.state === 'string' ? stored.state : '';
    const ok = oauthStateMatches(supplied, expectedState) && Boolean(stored?.role);
    expect(ok).toBe(false);
  });

  test('mismatched state rejects even when role is present', () => {
    const stored = { state: makeOAuthState(), role: 'buyer' };
    const supplied = makeOAuthState();
    const ok = oauthStateMatches(supplied, stored.state) && Boolean(stored.role);
    expect(ok).toBe(false);
  });

  test('matching state and role accepts for provider verification', () => {
    const state = makeOAuthState();
    const stored = { state, role: 'seller' };
    const ok = oauthStateMatches(state, stored.state) && Boolean(stored.role);
    expect(ok).toBe(true);
  });

  test('consuming oauthState blocks replay with the same state value', () => {
    const state = makeOAuthState();
    const session = { oauthState: { state, role: 'buyer' } };
    expect(oauthStateMatches(state, session.oauthState.state)).toBe(true);
    delete session.oauthState;
    const expected = typeof session.oauthState?.state === 'string' ? session.oauthState.state : '';
    expect(oauthStateMatches(state, expected)).toBe(false);
  });
});
