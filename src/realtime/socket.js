/**
 * M3/M4: Socket.IO real-time delivery for human-to-human messaging.
 * HTTP conversation service remains the source of truth for persistence.
 *
 * Production: one process → one attachSocketServer call + Redis adapter for multi-host fan-out.
 * Tests may attach more than one Server in-process (each with its own adapter clients).
 */
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { env } from '../config/environment.js';
import { isAllowedOrigin, getAllowedOrigins } from '../config/security.js';
import { logger } from '../config/logger.js';
import * as identityService from '../modules/identity/service.js';
import * as conversationService from '../modules/conversations/service.js';

const ROOM_PREFIX = 'conversation:';

/** @type {Set<import('socket.io').Server>} */
const ioServers = new Set();
/** @type {import('ioredis').Redis[]} */
const adapterClients = [];

export function conversationRoom(conversationId) {
  return `${ROOM_PREFIX}${String(conversationId)}`;
}

function wrapExpressMiddleware(middleware) {
  return (socket, next) => {
    const req = socket.request;
    const res = {
      getHeader() { return undefined; },
      setHeader() {},
      end() {},
    };
    middleware(req, res, next);
  };
}

function bindHandlers(io) {
  io.use((socket, next) => {
    const origin = socket.handshake.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
      return next(new Error('ORIGIN_NOT_ALLOWED'));
    }
    return next();
  });

  io.on('connection', (socket) => {
    logger.info({ accountId: socket.data.accountId, sid: socket.id }, 'Socket connected');

    socket.on('conversation:join', async (payload = {}, ack) => {
      try {
        const conversationId = payload.conversationId;
        if (!conversationId) {
          throw Object.assign(new Error('conversationId is required'), { code: 'INVALID_INPUT' });
        }
        await conversationService.getConversation(socket.data.account, conversationId);
        const room = conversationRoom(conversationId);
        await socket.join(room);
        if (typeof ack === 'function') ack({ ok: true, room });
        else socket.emit('conversation:joined', { conversationId, room });
      } catch (err) {
        const body = {
          ok: false,
          code: err.code || 'JOIN_FAILED',
          message: err.message || 'Unable to join conversation',
        };
        if (typeof ack === 'function') ack(body);
        else socket.emit('conversation:error', body);
      }
    });

    socket.on('conversation:leave', async (payload = {}, ack) => {
      try {
        const conversationId = payload.conversationId;
        if (conversationId) await socket.leave(conversationRoom(conversationId));
        if (typeof ack === 'function') ack({ ok: true });
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, message: err.message });
      }
    });

    socket.on('conversation:send', async (payload = {}, ack) => {
      try {
        const { conversationId, body, clientMessageId } = payload;
        const message = await conversationService.sendMessage(socket.data.account, conversationId, {
          body,
          clientMessageId,
        });
        const room = conversationRoom(conversationId);
        await socket.join(room);
        // Emit on this io; Redis adapter fans out to other instances.
        io.to(room).emit('conversation:message', {
          conversationId: String(conversationId),
          message,
        });
        if (typeof ack === 'function') ack({ ok: true, message });
      } catch (err) {
        const body = {
          ok: false,
          code: err.code || 'SEND_FAILED',
          message: err.message || 'Unable to send message',
          status: err.status,
        };
        if (typeof ack === 'function') ack(body);
        else socket.emit('conversation:error', body);
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info({ accountId: socket.data.accountId, sid: socket.id, reason }, 'Socket disconnected');
    });
  });
}

/**
 * @param {import('http').Server} httpServer
 * @param {{ sessionMiddleware: Function, enableRedisAdapter?: boolean }} options
 */
export async function attachSocketServer(httpServer, options = {}) {
  const { sessionMiddleware, enableRedisAdapter = true } = options;
  if (typeof sessionMiddleware !== 'function') {
    throw new Error('attachSocketServer requires sessionMiddleware from createApp()');
  }

  const io = new Server(httpServer, {
    cors: {
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (isAllowedOrigin(origin)) return callback(null, true);
        return callback(new Error('Origin not allowed'));
      },
      credentials: true,
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  if (enableRedisAdapter) {
    try {
      const pub = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: null,
        enableOfflineQueue: true,
        lazyConnect: false,
      });
      const sub = pub.duplicate();
      pub.on('error', (err) => logger.error({ error: err.message }, 'Socket.IO Redis pub error'));
      sub.on('error', (err) => logger.error({ error: err.message }, 'Socket.IO Redis sub error'));
      io.adapter(createAdapter(pub, sub));
      adapterClients.push(pub, sub);
      logger.info('Socket.IO Redis adapter attached');
    } catch (err) {
      logger.error({ error: err.message }, 'Socket.IO Redis adapter failed to initialize');
    }
  }

  io.use(wrapExpressMiddleware(sessionMiddleware));

  io.use(async (socket, next) => {
    try {
      const session = socket.request.session;
      const userId = session?.userId;
      if (!userId) return next(new Error('UNAUTHORIZED'));
      const account = await identityService.getAccountForSession(userId);
      if (!account) return next(new Error('UNAUTHORIZED'));
      if (session.sessionVersion != null
        && Number(account.sessionVersion || 0) !== Number(session.sessionVersion)) {
        return next(new Error('SESSION_INVALIDATED'));
      }
      socket.data.account = account;
      socket.data.accountId = String(account._id);
      return next();
    } catch (err) {
      logger.warn({ error: err.message }, 'Socket auth failed');
      return next(new Error('UNAUTHORIZED'));
    }
  });

  bindHandlers(io);
  ioServers.add(io);
  return io;
}

/** Emit a persisted message (HTTP path). Uses any local io; Redis adapter fans out. */
export function emitConversationMessage(conversationId, message) {
  const payload = {
    conversationId: String(conversationId),
    message,
  };
  const room = conversationRoom(conversationId);
  for (const io of ioServers) {
    io.to(room).emit('conversation:message', payload);
  }
}

export function getSocketServers() {
  return [...ioServers];
}

export function disconnectAccountSockets(accountId) {
  if (!accountId) return;
  const id = String(accountId);
  for (const io of ioServers) {
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data?.accountId === id) {
        socket.emit('session:invalidated', { reason: 'SESSION_INVALIDATED' });
        socket.disconnect(true);
      }
    }
  }
}

export async function closeSocketServer() {
  const servers = [...ioServers];
  ioServers.clear();
  await Promise.all(servers.map((io) => new Promise((resolve) => {
    try {
      io.close(() => resolve());
    } catch {
      resolve();
    }
  })));
  const clients = adapterClients.splice(0, adapterClients.length);
  await Promise.allSettled(clients.map(async (c) => {
    try {
      await c.quit();
    } catch {
      try { c.disconnect(); } catch { /* */ }
    }
  }));
}
