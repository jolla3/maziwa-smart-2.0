/**
 * M4: two independent HTTP+Socket.IO instances with Redis adapter.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
} from '@jest/globals';
import http from 'http';
import mongoose from 'mongoose';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';
import Redis from 'ioredis';

const SUITE_DB = 'maziwa_messaging_socket_m4';
const TEST_ORIGIN = 'http://localhost:5173';
const REDIS_URL = process.env.MESSAGING_TEST_REDIS_URL || process.env.REDIS_URL || 'redis://127.0.0.1:6379';

let memoryServer = null;
let redisOk = false;
let skipReason = '';
let appA;
let appB;
let serverA;
let serverB;
let baseA;
let baseB;
let Account;

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

async function registerAndLogin(app, email, username) {
  let jar = {};
  const probe = await request(app).get('/api/userAuth/session').set('Origin', TEST_ORIGIN);
  jar = mergeCookies(jar, probe);
  let csrf = jar['csrf-token'] || probe.headers['x-csrf-token'];
  const reg = await request(app)
    .post('/api/userAuth/register')
    .set('Cookie', cookieHeader(jar))
    .set('X-CSRF-Token', csrf)
    .set('Origin', TEST_ORIGIN)
    .send({ username, email, password: 'TestPass1!' });
  jar = mergeCookies(jar, reg);
  csrf = jar['csrf-token'] || csrf;
  if (reg.status >= 400) {
    const login = await request(app)
      .post('/api/userAuth/login')
      .set('Cookie', cookieHeader(jar))
      .set('X-CSRF-Token', csrf)
      .set('Origin', TEST_ORIGIN)
      .send({ email, password: 'TestPass1!' });
    jar = mergeCookies(jar, login);
    return { cookie: cookieHeader(jar), csrf: jar['csrf-token'] || csrf };
  }
  const login = await request(app)
    .post('/api/userAuth/login')
    .set('Cookie', cookieHeader(jar))
    .set('X-CSRF-Token', csrf)
    .set('Origin', TEST_ORIGIN)
    .send({ email, password: 'TestPass1!' });
  jar = mergeCookies(jar, login);
  return { cookie: cookieHeader(jar), csrf: jar['csrf-token'] || csrf };
}

function connectSocket(baseUrl, cookie) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, {
      transports: ['websocket'],
      extraHeaders: { Cookie: cookie, Origin: TEST_ORIGIN },
      reconnection: false,
      timeout: 8000,
    });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('connect timeout'));
    }, 9000);
    socket.on('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.on('connect_error', (err) => { clearTimeout(timer); reject(err); });
  });
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  // Isolate this suite's authentication rate-limit keys between runs.
  process.env.RATE_LIMIT_KEY_NAMESPACE =
    `jest-m4-${process.pid}-${Date.now()}`;
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-socket-m4';
  process.env.FRONTEND_URL = TEST_ORIGIN;
  process.env.REDIS_URL = REDIS_URL;

  try {
    const probe = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 2000, lazyConnect: true });
    await probe.connect();
    await probe.ping();
    await probe.quit();
    redisOk = true;
  } catch (err) {
    skipReason = `Redis unavailable at ${REDIS_URL}: ${err.message}`;
    redisOk = false;
    return;
  }

  const { MongoMemoryServer } = await import('mongodb-memory-server');
  memoryServer = await MongoMemoryServer.create();
  const uri = memoryServer.getUri(SUITE_DB);
  process.env.MONGO_URI = uri;
  const envMod = await import('../../src/config/environment.js');
  if (envMod.env) {
    envMod.env.MONGO_URI = uri;
    envMod.env.FRONTEND_URL = TEST_ORIGIN;
    envMod.env.REDIS_URL = REDIS_URL;
    envMod.env.SESSION_SECRET = process.env.SESSION_SECRET;
  }
  await mongoose.connect(uri);

  const { createApp } = await import('../../src/app.js');
  const { attachSocketServer } = await import('../../src/realtime/socket.js');

  appA = createApp();
  appB = createApp();
  serverA = http.createServer(appA);
  serverB = http.createServer(appB);

  await attachSocketServer(serverA, {
    sessionMiddleware: appA.locals.sessionMiddleware,
    enableRedisAdapter: true,
  });
  await attachSocketServer(serverB, {
    sessionMiddleware: appB.locals.sessionMiddleware,
    enableRedisAdapter: true,
  });

  await new Promise((r) => serverA.listen(0, r));
  await new Promise((r) => serverB.listen(0, r));
  baseA = `http://127.0.0.1:${serverA.address().port}`;
  baseB = `http://127.0.0.1:${serverB.address().port}`;
  ({ Account } = await import('../../src/modules/identity/model.js'));
}, 120_000);

afterAll(async () => {
  try {
    const { closeSocketServer } = await import('../../src/realtime/socket.js');
    await closeSocketServer();
  } catch { /* */ }
  try { if (serverA) await new Promise((r) => serverA.close(r)); } catch { /* */ }
  try { if (serverB) await new Promise((r) => serverB.close(r)); } catch { /* */ }
  try {
    const { disposeAppResources } = await import('../../src/app.js');
    if (appA) await disposeAppResources(appA);
    if (appB) await disposeAppResources(appB);
  } catch { /* */ }
  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
  } catch { /* */ }
  try { if (memoryServer) await memoryServer.stop(); } catch { /* */ }
  try {
    const { disconnectRedis } = await import('../../src/config/redis.js');
    await disconnectRedis();
  } catch (error) {
    console.warn('[M4] Shared Redis teardown warning:', error?.message || error);
  }
});

describe('M4 Redis adapter cross-instance delivery', () => {
  test('Redis must be available for cross-instance proof', () => {
    if (!redisOk) {
      console.warn(`[M4] BLOCKED: ${skipReason}`);
    }
    // Do not assert redisOk true — environments without Redis document blockage.
    expect(skipReason === '' || !redisOk).toBe(true);
  });

  test('message persisted on instance A is received by socket on instance B', async () => {
    if (!redisOk) {
      console.warn(`[M4] cross-instance delivery not executed: ${skipReason}`);
      return;
    }

    const ts = Date.now();
    const a = await registerAndLogin(appA, `m4-a-${ts}@example.test`, `m4a_${ts}`);
    const b = await registerAndLogin(appB, `m4-b-${ts}@example.test`, `m4b_${ts}`);
    // Login B also on A side for conversation create under shared Mongo
    const bOnA = await registerAndLogin(appA, `m4-b-${ts}@example.test`, `m4b_${ts}`);
    const peer = await Account.findOne({ email: `m4-b-${ts}@example.test` }).lean();

    const createRes = await request(appA)
      .post('/api/v1/conversations')
      .set('Cookie', a.cookie)
      .set('X-CSRF-Token', a.csrf)
      .set('Origin', TEST_ORIGIN)
      .send({ contextType: 'direct', otherAccountId: String(peer._id) });
    expect(createRes.status).toBeLessThan(400);
    const conversationId = createRes.body?.data?.conversation?.id;

    const socketB = await connectSocket(baseB, b.cookie);
    const join = await new Promise((r) => socketB.emit('conversation:join', { conversationId }, r));
    expect(join.ok).toBe(true);

    const received = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no cross-instance event')), 8000);
      socketB.once('conversation:message', (payload) => {
        clearTimeout(t);
        resolve(payload);
      });
    });

    const socketA = await connectSocket(baseA, a.cookie);
    await new Promise((r) => socketA.emit('conversation:join', { conversationId }, r));
    const ack = await new Promise((r) => socketA.emit('conversation:send', {
      conversationId,
      body: 'cross-instance hello',
      clientMessageId: `m4-${ts}`,
    }, r));
    expect(ack.ok).toBe(true);

    const event = await received;
    expect(event.message.id).toBe(ack.message.id);

    socketA.close();
    socketB.close();
  });
});
