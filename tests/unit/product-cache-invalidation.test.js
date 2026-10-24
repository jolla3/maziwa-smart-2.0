import { jest } from '@jest/globals';

describe('product cache invalidation', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('invalidatePublicProduct retries and reports failure without throwing', async () => {
    const multiExec = jest.fn()
      .mockRejectedValueOnce(new Error('redis down'))
      .mockRejectedValueOnce(new Error('redis down'));
    jest.unstable_mockModule('../../src/config/redis.js', () => ({
      getRedisClient: () => ({
        multi: () => ({
          incr() { return this; },
          del() { return this; },
          exec: multiExec,
        }),
      }),
    }));
    jest.unstable_mockModule('../../src/shared/cache/redisTimeout.js', () => ({
      withRedisTimeout: async (p) => p,
    }));
    jest.unstable_mockModule('../../src/config/environment.js', () => ({
      env: { PRODUCT_CACHE_TTL_SECONDS: 60 },
    }));
    jest.unstable_mockModule('../../src/config/logger.js', () => ({
      logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
    }));

    const { invalidatePublicProduct } = await import('../../src/shared/cache/productSingleFlight.js');
    const result = await invalidatePublicProduct({ cacheKey: 'k', genKey: 'g' });
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(2);
    expect(multiExec).toHaveBeenCalledTimes(2);
  });

  test('invalidatePublicProduct succeeds on second attempt', async () => {
    const multiExec = jest.fn()
      .mockRejectedValueOnce(new Error('redis blip'))
      .mockResolvedValueOnce([[null, 2], [null, 1]]);
    jest.unstable_mockModule('../../src/config/redis.js', () => ({
      getRedisClient: () => ({
        multi: () => ({
          incr() { return this; },
          del() { return this; },
          exec: multiExec,
        }),
      }),
    }));
    jest.unstable_mockModule('../../src/shared/cache/redisTimeout.js', () => ({
      withRedisTimeout: async (p) => p,
    }));
    jest.unstable_mockModule('../../src/config/environment.js', () => ({
      env: { PRODUCT_CACHE_TTL_SECONDS: 60 },
    }));
    jest.unstable_mockModule('../../src/config/logger.js', () => ({
      logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
    }));

    const { invalidatePublicProduct } = await import('../../src/shared/cache/productSingleFlight.js');
    const result = await invalidatePublicProduct({ cacheKey: 'k', genKey: 'g' });
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
  });
});
