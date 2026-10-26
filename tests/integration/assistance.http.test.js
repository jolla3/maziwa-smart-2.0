/**
 * Assistance HTTP integration: public POST, CSRF, optional session, validation.
 * No identity module mock (ESM circular risk). Session cases use real login.
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

const SUITE_DB = 'maziwa_assistance_http_test';
const TEST_ORIGIN = 'http://localhost:5173';

let memoryServer = null;
let app;
let Account;

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
  const csrf = jar['csrf-token'];
  return { jar, csrf, cookie: cookieHeader(jar) };
}

async function postAssistance(message, session) {
  const s = session || (await primeCsrf());
  const res = await request(app)
    .post('/api/v1/assistance/message')
    .set('Origin', TEST_ORIGIN)
    .set('Cookie', cookieHeader(s.jar))
    .set('X-CSRF-Token', s.csrf || s.jar['csrf-token'] || '')
    .send({ message });
  const jar = mergeCookies(s.jar, res);
  return { res, session: { jar, csrf: jar['csrf-token'] || s.csrf } };
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

  if (reg.status >= 400) {
    const login = await request(app)
      .post('/api/userAuth/login')
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', cookieHeader(jar))
      .set('X-CSRF-Token', csrf || '')
      .send({ email, password });
    jar = mergeCookies(jar, login);
    csrf = jar['csrf-token'] || csrf;
    return { jar, csrf, status: login.status, body: login.body };
  }

  // Some flows auto-login on register
  if (!jar['connect.sid']) {
    const login = await request(app)
      .post('/api/userAuth/login')
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', cookieHeader(jar))
      .set('X-CSRF-Token', csrf || '')
      .send({ email, password });
    jar = mergeCookies(jar, login);
    csrf = jar['csrf-token'] || csrf;
    return { jar, csrf, status: login.status, body: login.body };
  }

  return { jar, csrf, status: reg.status, body: reg.body };
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-assistance-http';
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

describe('Assistance HTTP — public outcomes', () => {
  test('POST help returns 200 answered envelope', async () => {
    const { res } = await postAssistance('help');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.outcome).toBe('answered');
    expect(res.body.data.intentId).toBe('help.what_can_you_do');
    expect(res.body.data).toHaveProperty('actions');
    expect(res.body.data).toHaveProperty('answerText');
  });

  test('anonymous product overview without login', async () => {
    const { res } = await postAssistance('what is maziwasmart');
    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('answered');
  });

  test('stateless registration follow-up', async () => {
    const s1 = await postAssistance('how do i register');
    expect(s1.res.body.data.outcome).toBe('need_input');
    const s2 = await postAssistance('farmer');
    expect(s2.res.body.data.outcome).toBe('answered');
    expect(s2.res.body.data.intentId).toBe('help.register_farmer');
  });

  test('clarify label marketplace', async () => {
    const { res } = await postAssistance('marketplace');
    expect(res.status).toBe(200);
    expect(res.body.data.intentId).toBe('help.marketplace_public');
  });
});

describe('Assistance HTTP — private_info session', () => {
  test('anonymous → auth_required', async () => {
    const { res } = await postAssistance('show my animals');
    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('auth_required');
  });

  test('logged-in verified session → disabled_in_mvp', async () => {
    const ts = Date.now();
    const session = await registerLogin(`assist-ver-${ts}@example.test`, `assist_ver_${ts}`);
    expect(session.status).toBeLessThan(400);

    const res = await request(app)
      .post('/api/v1/assistance/message')
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', cookieHeader(session.jar))
      .set('X-CSRF-Token', session.csrf || '')
      .send({ message: 'show my animals' });

    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('disabled_in_mvp');
  });
});

describe('Assistance HTTP — validation and CSRF', () => {
  test('empty message → 400 VALIDATION_ERROR', async () => {
    const { res } = await postAssistance('   ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('malformed JSON → 400 VALIDATION_ERROR', async () => {
    const session = await primeCsrf();
    const res = await request(app)
      .post('/api/v1/assistance/message')
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf || '')
      .set('Content-Type', 'application/json')
      .send('{"message":');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('missing CSRF header → 403', async () => {
    const session = await primeCsrf();
    const res = await request(app)
      .post('/api/v1/assistance/message')
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', session.cookie)
      .send({ message: 'help' });
    expect(res.status).toBe(403);
  });

  test('prohibited write → forbidden', async () => {
    const { res } = await postAssistance('publish my ad now');
    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('forbidden');
  });
});
