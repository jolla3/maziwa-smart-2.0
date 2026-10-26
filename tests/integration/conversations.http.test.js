/**
 * HTTP boundary tests: session auth + CSRF double-submit.
 * Routes: GET /api/userAuth/session, POST /api/userAuth/register|login
 * CSRF: unsafe methods require matching csrf-token cookie and X-CSRF-Token header.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';
import mongoose from 'mongoose';
import request from 'supertest';

const SUITE_DB = 'maziwa_messaging_http_test';
const TEST_ORIGIN = 'http://localhost:5173';

let memoryServer = null;
let app;
let Account;

const getMessagingTargetForAd = jest.fn();

const redisCounters = new Map();
const mockRedisClient = {
  incr: jest.fn(async (key) => {
    const next = (redisCounters.get(key) || 0) + 1;
    redisCounters.set(key, next);
    return next;
  }),
  pexpire: jest.fn(async () => 1),
  decr: jest.fn(async (key) => {
    const next = Math.max(0, (redisCounters.get(key) || 0) - 1);
    redisCounters.set(key, next);
    return next;
  }),
  del: jest.fn(async (key) => (redisCounters.delete(key) ? 1 : 0)),
};

jest.unstable_mockModule('../../src/config/redis.js', () => ({
  getRedisClient: jest.fn(() => mockRedisClient),
  checkRedisHealth: jest.fn(async () => ({ status: 'healthy', latencyMs: 0 })),
  isRedisReady: jest.fn(() => true),
  ensureRedisReady: jest.fn(async () => true),
  getRedisStatusSnapshot: jest.fn(() => ({ status: 'healthy', lastCheckAt: null })),
  disconnectRedis: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../../src/modules/livestock-marketplace/service.js', () => ({
  getMessagingTargetForAd,
  listPublicAds: jest.fn(async () => ({ items: [] })),
  getPublicAd: jest.fn(),
  createAd: jest.fn(),
  updateAd: jest.fn(),
  archiveAd: jest.fn(),
  listMyAds: jest.fn(),
  recordPublicView: jest.fn(),
  assertVerifiedSellerForPublish: jest.fn(),
  assertCanManageAd: jest.fn(),
}));

function extractCookies(res) {
  const raw = res.headers['set-cookie'] || [];
  const list = Array.isArray(raw) ? raw : [raw];
  const jar = {};
  for (const line of list) {
    if (!line) continue;
    const [pair] = String(line).split(';');
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

function conversationFrom(res) {
  const data = res.body?.data || {};
  return data.conversation || data;
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-messaging-http-r7';
  process.env.FRONTEND_URL = TEST_ORIGIN;

  const { MongoMemoryServer } = await import('mongodb-memory-server');
  memoryServer = await MongoMemoryServer.create();
  const uri = memoryServer.getUri(SUITE_DB);
  process.env.MONGO_URI = uri;

  const envMod = await import('../../src/config/environment.js');
  if (envMod.env) {
    envMod.env.MONGO_URI = uri;
    envMod.env.FRONTEND_URL = TEST_ORIGIN;
    envMod.env.SESSION_SECRET = process.env.SESSION_SECRET;
  }

  await mongoose.connect(uri);
  const { createApp } = await import('../../src/app.js');
  app = createApp();
  ({ Account } = await import('../../src/modules/identity/model.js'));
}, 120_000);

afterAll(async () => {
  const errors = [];
  try {
    const { disposeAppResources } = await import('../../src/app.js');
    if (app) await disposeAppResources(app);
  } catch (err) {
    errors.push(`sessionStore: ${err.message}`);
  }
  try {
    const { disconnectRedis } = await import('../../src/config/redis.js');
    await disconnectRedis();
  } catch (err) {
    errors.push(`redis: ${err.message}`);
  }
  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
  } catch (err) {
    errors.push(`mongoose: ${err.message}`);
  }
  try {
    if (memoryServer) {
      await memoryServer.stop();
      memoryServer = null;
    }
  } catch (err) {
    errors.push(`memoryServer: ${err.message}`);
  }
  if (errors.length) {
    // Surface cleanup issues without hiding them.
    // eslint-disable-next-line no-console
    console.warn('HTTP suite cleanup warnings:', errors.join('; '));
  }
});

beforeEach(async () => {
  redisCounters.clear();
  getMessagingTargetForAd.mockReset();
  if (Account) await Account.deleteMany({}).catch(() => {});
  try {
    const { Conversation, Message } = await import('../../src/modules/conversations/model.js');
    await Conversation.deleteMany({});
    await Message.deleteMany({});
  } catch { /* ignore */ }
});

async function registerAndLogin(email, username) {
  let jar = {};
  const probe = await request(app).get('/api/userAuth/session').set('Origin', TEST_ORIGIN);
  expect([200, 401]).toContain(probe.status);
  jar = mergeCookies(jar, probe);
  let csrf = jar['csrf-token'] || probe.headers['x-csrf-token'];
  expect(csrf).toBeTruthy();

  const reg = await request(app)
    .post('/api/userAuth/register')
    .set('Cookie', cookieHeader(jar))
    .set('X-CSRF-Token', csrf)
    .set('Origin', TEST_ORIGIN)
    .send({ username, email, password: 'TestPass1!' });
  jar = mergeCookies(jar, reg);
  csrf = jar['csrf-token'] || csrf;
  if (reg.status !== 201 && reg.status !== 200) {
    throw new Error(`register failed ${reg.status} ${JSON.stringify(reg.body)}`);
  }

  const login = await request(app)
    .post('/api/userAuth/login')
    .set('Cookie', cookieHeader(jar))
    .set('X-CSRF-Token', csrf)
    .set('Origin', TEST_ORIGIN)
    .send({ email, password: 'TestPass1!' });
  jar = mergeCookies(jar, login);
  csrf = jar['csrf-token'] || csrf;
  if (login.status !== 200) {
    throw new Error(`login failed ${login.status} ${JSON.stringify(login.body)}`);
  }
  expect(jar['connect.sid']).toBeTruthy();
  return { jar, csrf, cookie: cookieHeader(jar) };
}

describe('HTTP messaging: CSRF and session boundary', () => {
  test('unauthenticated GET /api/v1/conversations is 401', async () => {
    const res = await request(app).get('/api/v1/conversations').set('Origin', TEST_ORIGIN);
    expect(res.status).toBe(401);
  });

  test('mutation without CSRF header is 403 and creates no conversation', async () => {
    const ts = Date.now();
    const { cookie, jar } = await registerAndLogin(`miss-${ts}@example.test`, `miss_${ts}`);
    expect(jar['csrf-token']).toBeTruthy();
    const before = await (await import('../../src/modules/conversations/model.js')).Conversation.countDocuments();
    const res = await request(app)
      .post('/api/v1/conversations')
      .set('Cookie', cookie)
      .set('Origin', TEST_ORIGIN)
      .send({ contextType: 'direct', otherAccountId: new mongoose.Types.ObjectId().toString() });
    expect(res.status).toBe(403);
    const after = await (await import('../../src/modules/conversations/model.js')).Conversation.countDocuments();
    expect(after).toBe(before);
  });

  test('mutation with invalid CSRF header is 403', async () => {
    const ts = Date.now();
    const { cookie } = await registerAndLogin(`bad-${ts}@example.test`, `bad_${ts}`);
    const res = await request(app)
      .post('/api/v1/conversations')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', 'not-the-real-token')
      .set('Origin', TEST_ORIGIN)
      .send({ contextType: 'direct', otherAccountId: new mongoose.Types.ObjectId().toString() });
    expect(res.status).toBe(403);
  });

  test('mutation with valid cookie/header pair succeeds', async () => {
    const ts = Date.now();
    const a = await registerAndLogin(`ok-a-${ts}@example.test`, `oka_${ts}`);
    await registerAndLogin(`ok-b-${ts}@example.test`, `okb_${ts}`);
    const peer = await Account.findOne({ email: `ok-b-${ts}@example.test` }).lean();
    const res = await request(app)
      .post('/api/v1/conversations')
      .set('Cookie', a.cookie)
      .set('X-CSRF-Token', a.csrf)
      .set('Origin', TEST_ORIGIN)
      .send({ contextType: 'direct', otherAccountId: String(peer._id) });
    expect(res.status).toBeLessThan(400);
    const conv = conversationFrom(res);
    expect(conv.id || conv._id).toBeTruthy();
  });

  test('missing CSRF cookie on mutation is 403 and response primes a token', async () => {
    const ts = Date.now();
    // Register normally to create an account, then strip csrf cookie
    const session = await registerAndLogin(`prime-${ts}@example.test`, `prime_${ts}`);
    const jarNoCsrf = { ...session.jar };
    delete jarNoCsrf['csrf-token'];
    const res = await request(app)
      .post('/api/v1/conversations')
      .set('Cookie', cookieHeader(jarNoCsrf))
      .set('Origin', TEST_ORIGIN)
      .send({ contextType: 'direct', otherAccountId: new mongoose.Types.ObjectId().toString() });
    expect(res.status).toBe(403);
    const setCookies = res.headers['set-cookie'] || [];
    const csrfCookieLines = (Array.isArray(setCookies) ? setCookies : [setCookies])
      .filter((c) => String(c).startsWith('csrf-token='));
    const headerToken = res.headers['x-csrf-token'];
    expect(csrfCookieLines).toHaveLength(1);
    const csrfCookieToken = String(csrfCookieLines[0])
      .split(';', 1)[0]
      .slice('csrf-token='.length);
    expect(headerToken).toBeTruthy();
    expect(headerToken).toBe(csrfCookieToken);
  });

  test('disallowed Origin is 403', async () => {
    const ts = Date.now();
    const session = await registerAndLogin(`origin-${ts}@example.test`, `orig_${ts}`);
    const res = await request(app)
      .post('/api/v1/conversations')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .set('Origin', 'https://evil.example')
      .send({ contextType: 'direct', otherAccountId: new mongoose.Types.ObjectId().toString() });
    expect(res.status).toBe(403);
  });

  test('livestock_ad recipient is advertiserAccountId only', async () => {
    const ts = Date.now();
    const a = await registerAndLogin(`ad-a-${ts}@example.test`, `ada_${ts}`);
    await registerAndLogin(`ad-adv-${ts}@example.test`, `adv_${ts}`);
    const advertiser = await Account.findOne({ email: `ad-adv-${ts}@example.test` }).lean();
    const adId = new mongoose.Types.ObjectId();
    const createdBy = new mongoose.Types.ObjectId();
    const farmerProfileId = new mongoose.Types.ObjectId();
    getMessagingTargetForAd.mockResolvedValue({
      adId: String(adId),
      status: 'published',
      advertiserAccountId: String(advertiser._id),
      title: 'Listing',
      createdByAccountId: String(createdBy),
      farmerProfileId: String(farmerProfileId),
    });
    const res = await request(app)
      .post('/api/v1/conversations')
      .set('Cookie', a.cookie)
      .set('X-CSRF-Token', a.csrf)
      .set('Origin', TEST_ORIGIN)
      .send({ contextType: 'livestock_ad', livestockAdId: String(adId) });
    expect(res.status).toBeLessThan(400);
    const conv = conversationFrom(res);
    const parts = (conv.participantAccountIds || []).map(String);
    expect(parts).toContain(String(advertiser._id));
    expect(parts).not.toContain(String(createdBy));
    expect(parts).not.toContain(String(farmerProfileId));
  });

  test('chatbot fields cannot inject an assistant participant', async () => {
    const ts = Date.now();
    const a = await registerAndLogin(`bot-a-${ts}@example.test`, `bota_${ts}`);
    await registerAndLogin(`bot-b-${ts}@example.test`, `botb_${ts}`);
    const peer = await Account.findOne({ email: `bot-b-${ts}@example.test` }).lean();
    const initiator = await Account.findOne({ email: `bot-a-${ts}@example.test` }).lean();
    const res = await request(app)
      .post('/api/v1/conversations')
      .set('Cookie', a.cookie)
      .set('X-CSRF-Token', a.csrf)
      .set('Origin', TEST_ORIGIN)
      .send({
        contextType: 'direct',
        otherAccountId: String(peer._id),
        participantRole: 'assistant',
        botId: 'maziwa-assist',
      });
    expect(res.status).toBeLessThan(400);
    const conv = conversationFrom(res);
    const parts = (conv.participantAccountIds || []).map(String);
    expect(parts).toHaveLength(2);
    expect(parts).toEqual(expect.arrayContaining([String(initiator._id), String(peer._id)]));
    expect(parts).not.toContain('maziwa-assist');
    expect(parts.every((p) => mongoose.Types.ObjectId.isValid(p))).toBe(true);
  });
});
