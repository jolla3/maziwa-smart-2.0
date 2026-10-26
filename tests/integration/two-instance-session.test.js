/**
 * Two-instance shared session acceptance (connect-mongo).
 * Skips multi-instance cases only when MongoDB cannot be reached and
 * mongodb-memory-server is unavailable. A soft return is NOT a pass proof.
 */
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

process.env.NODE_ENV = 'test';
// Isolate this suite while both app instances share the same namespace.
process.env.RATE_LIMIT_KEY_NAMESPACE = `jest-two-instance-${process.pid}-${Date.now()}`;
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-not-for-production';
// Keep FRONTEND_URL same-site localhost so session cookies are not Secure-only in HTTP tests.
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
process.env.TRUST_PROXY_HOPS = process.env.TRUST_PROXY_HOPS || '0';

const SUITE_DB = 'maziwa_smart_v2_session_accept';

let memoryServer = null;
let createApp = null;
let Account = null;
let appA = null;
let appB = null;
let multiInstanceReady = false;
let skipReason = 'not initialized';

async function resolveMongoUri() {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    return memoryServer.getUri(SUITE_DB);
  } catch (error) {
    skipReason = `MongoMemoryServer unavailable (${error.message})`;
    return null;
  }
}

function extractCookies(res) {
  const raw = res.headers['set-cookie'] || [];
  const list = Array.isArray(raw) ? raw : [raw];
  const jar = {};
  for (const line of list) {
    if (!line) continue;
    const [pair] = line.split(';');
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return jar;
}

function cookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function mergeCookies(target, res) {
  return { ...target, ...extractCookies(res) };
}

function assertSessionCookieFlags(res) {
  const raw = res.headers['set-cookie'] || [];
  const list = Array.isArray(raw) ? raw : [raw];
  const sid = list.find((c) => String(c).startsWith('connect.sid='));
  expect(sid).toBeTruthy();
  expect(String(sid).toLowerCase()).toMatch(/httponly/);
  expect(String(sid).toLowerCase()).not.toMatch(/httponly=false/);
}

describe('two-instance shared Mongo session store', () => {
  const email = `session-accept-${Date.now()}@example.test`;
  const password = 'AcceptTest1!';
  let accountId = null;

  beforeAll(async () => {
    const mongoUri = await resolveMongoUri();
    if (!mongoUri) {
      multiInstanceReady = false;
      console.warn(`[two-instance-session] SKIPPED: ${skipReason}. Multi-instance shared session is NOT proven.`);
      return;
    }

    process.env.MONGO_URI = mongoUri;
    const envMod = await import('../../src/config/environment.js');
    envMod.env.MONGO_URI = mongoUri;
    envMod.env.FRONTEND_URL = 'http://localhost:5173';

    ({ createApp } = await import('../../src/app.js'));
    ({ Account } = await import('../../src/modules/identity/model.js'));
    await mongoose.connect(mongoUri);
    appA = createApp();
    appB = createApp();

    const passwordHash = await bcrypt.hash(password, 10);
    const account = await Account.create({
      username: 'Session Accept',
      email,
      role: 'buyer',
      passwordHash,
      isActive: true,
      onboardingComplete: true,
      sessionVersion: 0,
    });
    accountId = String(account._id);
    multiInstanceReady = true;
    console.info('[two-instance-session] Shared Mongo session store ready for multi-instance proof.');
  }, 180000);

  afterAll(async () => {
    try {
      if (accountId && Account) {
        await Account.deleteOne({ _id: accountId }).catch(() => {});
      }

      // Close both connect-mongo stores before disconnecting Mongoose.
      try {
        const { disposeAppResources } = await import('../../src/app.js');
        if (appA) await disposeAppResources(appA);
        if (appB) await disposeAppResources(appB);
      } catch (error) {
        console.warn(
          '[two-instance-session] Session-store teardown warning:',
          error?.message || error
        );
      }

      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect().catch(() => {});
      }
    } finally {
      try {
        const redisMod = await import('../../src/config/redis.js');
        if (typeof redisMod.disconnectRedis === 'function') {
          await redisMod.disconnectRedis();
        }
      } catch {
        /* optional in unit environments */
      }
      if (memoryServer) {
        await memoryServer.stop().catch(() => {});
        memoryServer = null;
      }
    }
  });

  test('login on instance A is accepted by instance B via shared cookie', async () => {
    if (!multiInstanceReady) {
      throw new Error(`BLOCKED: multi-instance proof requires MongoDB. ${skipReason}`);
    }
    let jar = {};
    let res = await request(appA).get('/api/userAuth/session').expect(200);
    jar = mergeCookies(jar, res);
    expect(res.body.authenticated).toBe(false);

    res = await request(appA)
      .post('/api/userAuth/login')
      .set('Cookie', cookieHeader(jar))
      .set('Origin', 'http://localhost:5173')
      .send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user).toMatchObject({ email, role: 'buyer' });
    expect(res.body).not.toHaveProperty('token');
    assertSessionCookieFlags(res);
    jar = mergeCookies(jar, res);
    expect(jar['connect.sid']).toBeTruthy();

    res = await request(appB)
      .get('/api/userAuth/session')
      .set('Cookie', cookieHeader(jar))
      .expect(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.user).toMatchObject({ email, role: 'buyer' });
  });

  test('unauthenticated request to B remains unauthenticated', async () => {
    if (!multiInstanceReady) throw new Error(`BLOCKED: multi-instance proof requires MongoDB. ${skipReason}`);
    const res = await request(appB).get('/api/userAuth/session').expect(200);
    expect(res.body.authenticated).toBe(false);
    expect(res.body.user).toBeNull();
  });

  test('logout on A invalidates the session on B', async () => {
    if (!multiInstanceReady) throw new Error(`BLOCKED: multi-instance proof requires MongoDB. ${skipReason}`);
    let jar = {};
    let res = await request(appA).get('/api/userAuth/session').expect(200);
    jar = mergeCookies(jar, res);

    res = await request(appA)
      .post('/api/userAuth/login')
      .set('Cookie', cookieHeader(jar))
      .set('Origin', 'http://localhost:5173')
      .send({ email, password })
      .expect(200);
    jar = mergeCookies(jar, res);

    const csrf = jar['csrf-token'];
    expect(csrf).toBeTruthy();

    res = await request(appA)
      .post('/api/userAuth/logout')
      .set('Cookie', cookieHeader(jar))
      .set('Origin', 'http://localhost:5173')
      .set('x-csrf-token', csrf);
    if (res.status !== 200) {
      // eslint-disable-next-line no-console
      console.error('logout failed', res.status, res.body);
    }
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    res = await request(appB)
      .get('/api/userAuth/session')
      .set('Cookie', cookieHeader(jar))
      .expect(200);
    expect(res.body.authenticated).toBe(false);
  });

  test('inactive account cannot continue authenticating across instances', async () => {
    if (!multiInstanceReady) throw new Error(`BLOCKED: multi-instance proof requires MongoDB. ${skipReason}`);
    let jar = {};
    let res = await request(appA).get('/api/userAuth/session').expect(200);
    jar = mergeCookies(jar, res);

    res = await request(appA)
      .post('/api/userAuth/login')
      .set('Cookie', cookieHeader(jar))
      .set('Origin', 'http://localhost:5173')
      .send({ email, password })
      .expect(200);
    jar = mergeCookies(jar, res);

    await Account.updateOne({ _id: accountId }, { $set: { isActive: false } });
    res = await request(appB)
      .get('/api/userAuth/session')
      .set('Cookie', cookieHeader(jar))
      .expect(200);
    expect(res.body.authenticated).toBe(false);
    await Account.updateOne({ _id: accountId }, { $set: { isActive: true } });
  });

  test('sessionVersion mismatch invalidates sessions across instances', async () => {
    if (!multiInstanceReady) throw new Error(`BLOCKED: multi-instance proof requires MongoDB. ${skipReason}`);
    let jar = {};
    let res = await request(appA).get('/api/userAuth/session').expect(200);
    jar = mergeCookies(jar, res);

    res = await request(appA)
      .post('/api/userAuth/login')
      .set('Cookie', cookieHeader(jar))
      .set('Origin', 'http://localhost:5173')
      .send({ email, password })
      .expect(200);
    jar = mergeCookies(jar, res);

    res = await request(appB)
      .get('/api/userAuth/session')
      .set('Cookie', cookieHeader(jar))
      .expect(200);
    expect(res.body.authenticated).toBe(true);

    await Account.updateOne({ _id: accountId }, { $inc: { sessionVersion: 1 } });
    res = await request(appB)
      .get('/api/userAuth/session')
      .set('Cookie', cookieHeader(jar))
      .expect(200);
    expect(res.body.authenticated).toBe(false);
  });

  test('CSRF rejects mismatched token on logout', async () => {
    if (!multiInstanceReady) throw new Error(`BLOCKED: multi-instance proof requires MongoDB. ${skipReason}`);
    let jar = {};
    let res = await request(appA).get('/api/userAuth/session').expect(200);
    jar = mergeCookies(jar, res);

    res = await request(appA)
      .post('/api/userAuth/login')
      .set('Cookie', cookieHeader(jar))
      .set('Origin', 'http://localhost:5173')
      .send({ email, password })
      .expect(200);
    jar = mergeCookies(jar, res);

    res = await request(appA)
      .post('/api/userAuth/logout')
      .set('Cookie', cookieHeader(jar))
      .set('Origin', 'http://localhost:5173')
      .set('x-csrf-token', 'not-the-real-token')
      .expect(403);
    expect(res.status).toBe(403);
  });

  test('gating reports multi-instance readiness', () => {
    if (!multiInstanceReady) {
      console.warn(`[two-instance-session] multi-instance NOT proven: ${skipReason}`);
    }
    expect(typeof multiInstanceReady).toBe('boolean');
  });
});
