import { jest } from '@jest/globals';
import request from 'supertest';

const isDatabaseReady = jest.fn(() => true);
const checkRedisHealth = jest.fn(async () => ({ status: 'healthy', latencyMs: 1 }));

jest.unstable_mockModule('../../src/config/database.js', () => ({
  isDatabaseReady,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
}));
jest.unstable_mockModule('../../src/config/redis.js', () => ({
  checkRedisHealth,
  getRedisClient: jest.fn(),
  ensureRedisReady: jest.fn(),
  disconnectRedis: jest.fn(),
  isRedisReady: jest.fn(() => true),
  getRedisStatusSnapshot: jest.fn(),
}));
jest.unstable_mockModule('express-session', () => ({
  default: jest.fn(() => (req, _res, next) => {
    req.session = {
      save: (cb) => cb?.(null),
      regenerate: (cb) => cb?.(null),
      destroy: (cb) => cb?.(null),
    };
    next();
  }),
}));
jest.unstable_mockModule('connect-mongo', () => ({
  default: { create: jest.fn(() => ({})) },
}));
jest.unstable_mockModule('../../src/shared/middleware/rateLimit.js', () => ({
  authRateLimiter: (_req, _res, next) => next(),
  generalApiRateLimiter: (_req, _res, next) => next(),
  webhookRateLimiter: (_req, _res, next) => next(),
  smsRateLimiter: (_req, _res, next) => next(),
}));

const { createApp } = await import('../../src/app.js');

describe('lifecycle health and readiness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isDatabaseReady.mockReturnValue(true);
    checkRedisHealth.mockResolvedValue({ status: 'healthy', latencyMs: 2 });
  });

  test('GET /health is liveness-only and does not require dependency checks', async () => {
    const res = await request(createApp()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(isDatabaseReady).not.toHaveBeenCalled();
    expect(checkRedisHealth).not.toHaveBeenCalled();
  });

  test('GET /api/v1/health mirrors liveness', async () => {
    const res = await request(createApp()).get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  test('GET /ready is 200 only when mongo and redis report ready', async () => {
    const res = await request(createApp()).get('/ready').expect(200);
    expect(res.body).toMatchObject({
      status: 'ready',
      mongo: 'ready',
      redis: 'ready',
    });
    expect(isDatabaseReady).toHaveBeenCalled();
    expect(checkRedisHealth).toHaveBeenCalled();
  });

  test('GET /ready is 503 when mongo is not ready', async () => {
    isDatabaseReady.mockReturnValue(false);
    const res = await request(createApp()).get('/ready').expect(503);
    expect(res.body.status).toBe('not_ready');
    expect(res.body.mongo).toBe('not_ready');
  });

  test('GET /ready is 503 when redis is not healthy', async () => {
    checkRedisHealth.mockResolvedValue({ status: 'unhealthy', latencyMs: null });
    const res = await request(createApp()).get('/ready').expect(503);
    expect(res.body.status).toBe('not_ready');
    expect(res.body.redis).toBe('not_ready');
  });
});
