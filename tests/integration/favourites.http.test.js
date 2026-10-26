/**
 * Favourites HTTP: session auth, CSRF, ownership, public visibility.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';
import mongoose from 'mongoose';
import request from 'supertest';

const SUITE_DB = 'maziwa_favourites_http_test';
const TEST_ORIGIN = 'http://localhost:5173';

let memoryServer = null;
let app;
let Account;
let LivestockAd;
let Favourite;

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

async function primeCsrf() {
  let jar = {};
  const probe = await request(app).get('/api/userAuth/session').set('Origin', TEST_ORIGIN);
  jar = mergeCookies(jar, probe);
  return { jar, csrf: jar['csrf-token'] };
}

async function registerLogin(email, username, password = 'Passw0rd!') {
  let jar = {};
  const probe = await request(app).get('/api/userAuth/session').set('Origin', TEST_ORIGIN);
  jar = mergeCookies(jar, probe);
  let csrf = jar['csrf-token'];
  const reg = await request(app)
    .post('/api/userAuth/register')
    .set('Origin', TEST_ORIGIN)
    .set('Cookie', cookieHeader(jar))
    .set('X-CSRF-Token', csrf || '')
    .send({ email, username, password });
  jar = mergeCookies(jar, reg);
  csrf = jar['csrf-token'] || csrf;
  if (reg.status >= 400 || !jar['connect.sid']) {
    const login = await request(app)
      .post('/api/userAuth/login')
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', cookieHeader(jar))
      .set('X-CSRF-Token', csrf || '')
      .send({ email, password });
    jar = mergeCookies(jar, login);
    csrf = jar['csrf-token'] || csrf;
    expect(login.status).toBeLessThan(400);
  }
  return { jar, csrf };
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-favourites';
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
  ({ LivestockAd } = await import('../../src/modules/livestock-marketplace/model.js'));
  ({ Favourite } = await import('../../src/modules/favourites/model.js'));
  await Favourite.init();
}, 120_000);

afterAll(async () => {
  try {
    const { disposeAppResources } = await import('../../src/app.js');
    if (app) await disposeAppResources(app);
  } catch { /* ignore */ }
  try {
    await mongoose.disconnect();
  } catch { /* ignore */ }
  try {
    if (memoryServer) await memoryServer.stop();
  } catch { /* ignore */ }
}, 60_000);

describe('favourites HTTP auth and CSRF', () => {
  test('GET without session → 401', async () => {
    const res = await request(app).get('/api/v1/favourites').set('Origin', TEST_ORIGIN);
    expect(res.status).toBe(401);
  });

  test('PUT without CSRF → 403', async () => {
    const ts = Date.now();
    const session = await registerLogin(`fav-csrf-${ts}@example.test`, `fav_csrf_${ts}`);
    const res = await request(app)
      .put(`/api/v1/favourites/${new mongoose.Types.ObjectId()}`)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', cookieHeader(session.jar))
      .send({});
    expect(res.status).toBe(403);
  });
});

describe('favourites HTTP save/list/delete', () => {
  test('save published, list scoped, idempotent delete, unavailable projection', async () => {
    const ts = Date.now();
    const a = await registerLogin(`fav-a-${ts}@example.test`, `fav_a_${ts}`);
    const b = await registerLogin(`fav-b-${ts}@example.test`, `fav_b_${ts}`);

    const accountDoc = await Account.findOne({ email: `fav-a-${ts}@example.test` });
    const ad = await LivestockAd.create({
      advertiserAccountId: accountDoc._id,
      title: 'HTTP published cow',
      species: 'cow',
      price: 5000,
      currency: 'KES',
      status: 'published',
      publishedAt: new Date(),
    });
    const draft = await LivestockAd.create({
      advertiserAccountId: accountDoc._id,
      title: 'Draft cow',
      species: 'cow',
      price: 1,
      currency: 'KES',
      status: 'draft',
    });

    // Cannot save draft
    let res = await request(app)
      .put(`/api/v1/favourites/${draft._id}`)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', cookieHeader(a.jar))
      .set('X-CSRF-Token', a.csrf || '')
      .send({ accountId: 'forged' });
    expect(res.status).toBe(404);

    // Save published (body accountId ignored)
    res = await request(app)
      .put(`/api/v1/favourites/${ad._id}`)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', cookieHeader(a.jar))
      .set('X-CSRF-Token', a.csrf || '')
      .send({ accountId: String(accountDoc._id) });
    expect(res.status).toBe(200);
    expect(res.body.data.saved).toBe(true);

    // Repeat save
    res = await request(app)
      .put(`/api/v1/favourites/${ad._id}`)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', cookieHeader(a.jar))
      .set('X-CSRF-Token', a.csrf || '')
      .send({});
    expect(res.status).toBe(200);
    expect(await Favourite.countDocuments({})).toBe(1);

    // A lists own
    res = await request(app)
      .get('/api/v1/favourites')
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', cookieHeader(a.jar));
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].ad.title).toBe('HTTP published cow');

    // B does not see A's list
    res = await request(app)
      .get('/api/v1/favourites')
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', cookieHeader(b.jar));
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(0);

    // Archive ad → unavailable
    ad.status = 'archived';
    await ad.save();
    res = await request(app)
      .get('/api/v1/favourites')
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', cookieHeader(a.jar));
    expect(res.body.data.items[0].availability).toBe('unavailable');
    expect(res.body.data.items[0].ad).toBeNull();

    // Delete unavailable ok
    res = await request(app)
      .delete(`/api/v1/favourites/${ad._id}`)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', cookieHeader(a.jar))
      .set('X-CSRF-Token', a.csrf || '');
    expect(res.status).toBe(200);
    expect(res.body.data.saved).toBe(false);

    // Idempotent delete
    res = await request(app)
      .delete(`/api/v1/favourites/${ad._id}`)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', cookieHeader(a.jar))
      .set('X-CSRF-Token', a.csrf || '');
    expect(res.status).toBe(200);

    // Public marketplace still anonymous for published (re-publish check)
    const pub = await LivestockAd.create({
      advertiserAccountId: accountDoc._id,
      title: 'Still public',
      species: 'cow',
      price: 9,
      currency: 'KES',
      status: 'published',
      publishedAt: new Date(),
    });
    res = await request(app).get(`/api/v1/marketplace/${pub._id}`).set('Origin', TEST_ORIGIN);
    expect(res.status).toBe(200);
    expect(res.body.data?.title || res.body.data?.ad?.title || res.body.data).toBeTruthy();
  });
});
