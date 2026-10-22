import { jest } from '@jest/globals';
import request from 'supertest';

const passThrough = (_req, _res, next) => next();

const testAccount = {
  _id: 'account-test-id',
  sessionVersion: 3,
  role: 'buyer',
  email: 'buyer@example.com',
  username: 'Buyer',
  isActive: true,
};

jest.unstable_mockModule('express-session', () => ({
  default: jest.fn(() => (req, _res, next) => {
    req.session = {
      save(callback) {
        callback?.(null);
      },
      regenerate(callback) {
        callback?.(null);
      },
      destroy(callback) {
        callback?.(null);
      },
    };
    next();
  }),
}));

jest.unstable_mockModule('connect-mongo', () => ({
  default: {
    create: jest.fn(() => ({})),
  },
}));

jest.unstable_mockModule('../../src/shared/middleware/rateLimit.js', () => ({
  authRateLimiter: passThrough,
  generalApiRateLimiter: passThrough,
  webhookRateLimiter: passThrough,
  smsRateLimiter: passThrough,
}));

jest.unstable_mockModule('../../src/modules/identity/service.js', () => ({
  authenticatePassword: jest.fn(async () => testAccount),
  completePasswordSetup: jest.fn(),
  findOrCreateGoogleAccount: jest.fn(),
  getProfile: jest.fn(),
  needsPasswordSetup: jest.fn(),
  publicAccount: jest.fn((account) => ({
    id: String(account._id),
    role: account.role,
  })),
  registerBuyer: jest.fn(),
  registerFarmer: jest.fn(),
  registerSeller: jest.fn(),
  requestPasswordReset: jest.fn(),
  resetPassword: jest.fn(),
  updateProfile: jest.fn(),
}));

const { createApp } = await import('../../src/app.js');

describe('identity routes through the real application', () => {
  test('serves the session endpoint', async () => {
    const response = await request(createApp())
      .get('/api/userAuth/session')
      .expect(200);

    expect(response.body).toEqual({
      authenticated: false,
      pendingPasswordSetup: false,
      user: null,
    });
  });

  test('allows first login without an existing CSRF token', async () => {
    const response = await request(createApp())
      .post('/api/userAuth/login')
      .send({
        email: 'buyer@example.com',
        password: 'secret123',
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.user).toEqual({
      id: 'account-test-id',
      role: 'buyer',
    });
    expect(response.body).not.toHaveProperty('token');
  });

  test('rejects logout when the CSRF token is missing', async () => {
    const response = await request(createApp())
      .post('/api/userAuth/logout')
      .expect(403);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  test('returns 404 for an unknown identity route', async () => {
    const response = await request(createApp())
      .get('/api/userAuth/not-a-real-route')
      .expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});