/**
 * Cross-instance public product cache-miss single-flight (Redis).
 * Adapted from CACHE_MISS_FLOW.md: SET NX lock + generation fence + bounded wait.
 * Outage behavior: fall through to loader (availability mode) — documented as degraded.
 */
import crypto from 'node:crypto';
import { getRedisClient } from '../../config/redis.js';
import { withRedisTimeout } from './redisTimeout.js';
import { env } from '../../config/environment.js';
import { logger } from '../../config/logger.js';

const LOCK_TTL_MS = 5000;
const WAIT_BUDGET_MS = 2000;
const POLL_MS = 50;

async function redisCall(promise, ms = 300) {
  return withRedisTimeout(promise, ms);
}

export async function getOrLoadPublicProduct({ cacheKey, lockKey, genKey, loader, ttlSeconds }) {
  const ttl = ttlSeconds || env.PRODUCT_CACHE_TTL_SECONDS || 60;
  let redis;
  try {
    redis = getRedisClient();
  } catch {
    return loader();
  }

  try {
    const cached = await redisCall(redis.get(cacheKey));
    if (cached) return JSON.parse(cached);
  } catch (error) {
    logger.warn({ error: error.message }, 'product cache get failed; loading source');
    return loader();
  }

  const token = crypto.randomBytes(16).toString('hex');
  let acquired = false;
  try {
    const ok = await redisCall(redis.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX'));
    acquired = ok === 'OK';
  } catch {
    return loader();
  }

  if (!acquired) {
    const deadline = Date.now() + WAIT_BUDGET_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      try {
        const cached = await redisCall(redis.get(cacheKey));
        if (cached) return JSON.parse(cached);
        const lock = await redisCall(redis.get(lockKey));
        if (!lock) break; // lock gone — re-enter by loading
      } catch {
        break;
      }
    }
    return loader();
  }

  let generationAtStart = '0';
  try {
    generationAtStart = String((await redisCall(redis.get(genKey))) || '0');
  } catch {
    generationAtStart = '0';
  }

  try {
    const value = await loader();
    try {
      const currentGen = String((await redisCall(redis.get(genKey))) || '0');
      const lockOwner = await redisCall(redis.get(lockKey));
      if (lockOwner === token && currentGen === generationAtStart) {
        await redisCall(redis.set(cacheKey, JSON.stringify(value), 'EX', ttl));
      }
    } catch (error) {
      logger.warn({ error: error.message }, 'product cache fill skipped');
    }
    return value;
  } finally {
    try {
      const lockOwner = await redisCall(redis.get(lockKey));
      if (lockOwner === token) await redisCall(redis.del(lockKey));
    } catch {
      // ignore
    }
  }
}

export async function invalidatePublicProduct({ cacheKey, genKey }) {
  try {
    const redis = getRedisClient();
    const multi = redis.multi();
    multi.incr(genKey);
    multi.del(cacheKey);
    await redisCall(multi.exec());
  } catch (error) {
    logger.warn({ error: error.message }, 'product cache invalidation failed');
  }
}
