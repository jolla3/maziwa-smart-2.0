/**
 * M3 Socket.IO tests: session auth, origin, join ACL, persist-before-emit.
 * Uses MongoMemoryServer + HTTP session cookies + socket.io-client.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from '@jest/globals';
import http from 'http';
import mongoose from 'mongoose';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';

const SUITE_DB = 'maziwa_messaging_socket_m3';
const TEST_ORIGIN = 'http://localhost:5173';

let memoryServer = null;
let app;
let httpServer;
let Account;
let baseUrl;

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

async function registerAndLogin(email, username) {
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
  expect([200, 201]).toContain(reg.status);
  const login = await request(app)
    .post('/api/userAuth/login')
    .set('Cookie', cookieHeader(jar))
    .set('X-CSRF-Token', csrf)
    .set('Origin', TEST_ORIGIN)
    .send({ email, password: 'TestPass1!' });
  jar = mergeCookies(jar, login);
  csrf = jar['csrf-token'] || csrf;
  expect(login.status).toBe(200);
  return { jar, csrf, cookie: cookieHeader(jar) };
}

function connectSocket(cookie, origin = TEST_ORIGIN) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, {
      path: '/socket.io',
      transports: ['websocket'],
      extraHeaders: {
        Cookie: cookie || '',
        Origin: origin,
      },
      reconnection: false,
      timeout: 5000,
    });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('socket connect timeout'));
    }, 6000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  // Isolate this suite's Redis rate-limit keys from previous test runs.
  process.env.RATE_LIMIT_KEY_NAMESPACE =
    `jest-m3-${process.pid}-${Date.now()}`;
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-socket-m3';
  process.env.FRONTEND_URL = TEST_ORIGIN;
  process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

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
  httpServer = http.createServer(app);
  const { attachSocketServer } = await import('../../src/realtime/socket.js');
  // M3 tests: no Redis adapter (single process)
  await attachSocketServer(httpServer, {
    sessionMiddleware: app.locals.sessionMiddleware,
    enableRedisAdapter: false,
  });
  await new Promise((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address();
  baseUrl = `http://127.0.0.1:${port}`;
  ({ Account } = await import('../../src/modules/identity/model.js'));
}, 120_000);

afterAll(async () => {
  const errors = [];
  try {
    const { closeSocketServer } = await import('../../src/realtime/socket.js');
    await closeSocketServer();
  } catch (e) { errors.push(e.message); }
  try {
    await new Promise((resolve) => httpServer.close(resolve));
  } catch (e) { errors.push(e.message); }
  try {
    const { disposeAppResources } = await import('../../src/app.js');
    await disposeAppResources(app);
  } catch (e) { errors.push(e.message); }
  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
  } catch (e) { errors.push(e.message); }
  try {
    if (memoryServer) await memoryServer.stop();
  } catch (e) { errors.push(e.message); }
  try {
    const { disconnectRedis } = await import('../../src/config/redis.js');
    await disconnectRedis();
  } catch (e) { errors.push(e.message); }
  if (errors.length) console.warn('M3 teardown warnings:', errors.join('; '));
});

beforeEach(async () => {
  if (Account) await Account.deleteMany({});
  const { Conversation, Message } = await import('../../src/modules/conversations/model.js');
  await Conversation.deleteMany({});
  await Message.deleteMany({});
});

describe('M3 Socket.IO messaging', () => {
  test('unauthenticated socket is rejected', async () => {
    await expect(connectSocket('')).rejects.toBeTruthy();
  });

  test('invalid Origin is rejected', async () => {
    const ts = Date.now();
    const session = await registerAndLogin(`sock-origin-${ts}@example.test`, `so_${ts}`);
    await expect(connectSocket(session.cookie, 'https://evil.example')).rejects.toBeTruthy();
  });

  test('valid session can connect and join own conversation', async () => {
    const ts = Date.now();
    const a = await registerAndLogin(`sock-a-${ts}@example.test`, `sa_${ts}`);
    const b = await registerAndLogin(`sock-b-${ts}@example.test`, `sb_${ts}`);
    const peer = await Account.findOne({ email: `sock-b-${ts}@example.test` }).lean();

    const createRes = await request(app)
      .post('/api/v1/conversations')
      .set('Cookie', a.cookie)
      .set('X-CSRF-Token', a.csrf)
      .set('Origin', TEST_ORIGIN)
      .send({ contextType: 'direct', otherAccountId: String(peer._id) });
    expect(createRes.status).toBeLessThan(400);
    const conversationId = createRes.body?.data?.conversation?.id || createRes.body?.data?.id;

    const socket = await connectSocket(a.cookie);
    const joinResult = await new Promise((resolve) => {
      socket.emit('conversation:join', { conversationId }, resolve);
    });
    expect(joinResult.ok).toBe(true);
    socket.close();
  });

  test('cannot join another account conversation', async () => {
    const ts = Date.now();
    const a = await registerAndLogin(`sock-acl-a-${ts}@example.test`, `saa_${ts}`);
    const b = await registerAndLogin(`sock-acl-b-${ts}@example.test`, `sab_${ts}`);
    const c = await registerAndLogin(`sock-acl-c-${ts}@example.test`, `sac_${ts}`);
    const peerB = await Account.findOne({ email: `sock-acl-b-${ts}@example.test` }).lean();
    const createRes = await request(app)
      .post('/api/v1/conversations')
      .set('Cookie', a.cookie)
      .set('X-CSRF-Token', a.csrf)
      .set('Origin', TEST_ORIGIN)
      .send({ contextType: 'direct', otherAccountId: String(peerB._id) });
    const conversationId = createRes.body?.data?.conversation?.id;
    const socketC = await connectSocket(c.cookie);
    const joinResult = await new Promise((resolve) => {
      socketC.emit('conversation:join', { conversationId }, resolve);
    });
    expect(joinResult.ok).toBe(false);
    socketC.close();
  });

  test('message is emitted only after persist; duplicate clientMessageId is idempotent', async () => {
    const ts = Date.now();
    const a = await registerAndLogin(`sock-msg-a-${ts}@example.test`, `sma_${ts}`);
    const b = await registerAndLogin(`sock-msg-b-${ts}@example.test`, `smb_${ts}`);
    const peer = await Account.findOne({ email: `sock-msg-b-${ts}@example.test` }).lean();
    const createRes = await request(app)
      .post('/api/v1/conversations')
      .set('Cookie', a.cookie)
      .set('X-CSRF-Token', a.csrf)
      .set('Origin', TEST_ORIGIN)
      .send({ contextType: 'direct', otherAccountId: String(peer._id) });
    const conversationId = createRes.body?.data?.conversation?.id;

    const socketA = await connectSocket(a.cookie);
    const socketB = await connectSocket(b.cookie);

    await new Promise((r) => socketA.emit('conversation:join', { conversationId }, r));
    await new Promise((r) => socketB.emit('conversation:join', { conversationId }, r));

    const received = new Promise((resolve) => {
      socketB.once('conversation:message', resolve);
    });

    const ack1 = await new Promise((resolve) => {
      socketA.emit('conversation:send', {
        conversationId,
        body: 'Hello live',
        clientMessageId: `cid-${ts}`,
      }, resolve);
    });
    expect(ack1.ok).toBe(true);
    expect(ack1.message?.id).toBeTruthy();

    const event = await Promise.race([
      received,
      new Promise((_, rej) => setTimeout(() => rej(new Error('no message event')), 5000)),
    ]);
    expect(event.message.id).toBe(ack1.message.id);

    const ack2 = await new Promise((resolve) => {
      socketA.emit('conversation:send', {
        conversationId,
        body: 'Hello live',
        clientMessageId: `cid-${ts}`,
      }, resolve);
    });
    expect(ack2.ok).toBe(true);
    expect(ack2.message.id).toBe(ack1.message.id);

    const { Message } = await import('../../src/modules/conversations/model.js');
    const count = await Message.countDocuments({ clientMessageId: `cid-${ts}` });
    expect(count).toBe(1);

    socketA.close();
    socketB.close();
  });
});
