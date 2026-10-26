/**
 * MongoDB-backed integration tests for messaging M1/M2.
 *
 * SAFETY:
 * - Default: isolated MongoMemoryServer only (never process.env.MONGO_URI).
 * - External Mongo fallback REMOVED. MongoMemoryServer is required.
 * - Never uses application MONGO_URI for suite connection selection.
 * - dropDatabase only against the memory-owned connection created by this suite.
 *
 * When MongoMemoryServer cannot start and no valid MESSAGING_TEST_MONGO_URI is
 * set, the suite is reported as SKIPPED (not passed).
 *
 * Service coverage uses the real conversations service with marketplace/identity
 * modules mocked at the boundary (not a hand-written service approximation).
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

const SUITE_DB_NAME = 'maziwa_messaging_test';

function isAllowedExternalTestUri(uri) {
  if (!uri || typeof uri !== 'string') return false;
  try {
    const u = new URL(uri);
    const path = (u.pathname || '').replace(/^\//, '').split('/')[0];
    return path === SUITE_DB_NAME;
  } catch {
    return false;
  }
}

let memoryServer = null;
/** 'memory' | 'external-owned' | null */
let dbOwnership = null;
let setupError = null;

const getMessagingTargetForAd = jest.fn();
const getActiveAccountRef = jest.fn();

jest.unstable_mockModule('../../src/modules/livestock-marketplace/service.js', () => ({
  getMessagingTargetForAd,
}));
jest.unstable_mockModule('../../src/modules/identity/service.js', () => ({
  getActiveAccountRef,
}));

let Conversation;
let Message;
let Notification;
let createOrGetConversation;
let sendMessage;
let markConversationRead;
let completeMessageSideEffects;
let reconcilePendingMessageSideEffects;
let __setMarkReadTestHooks;

async function connectIsolated() {
  // Memory server only. No MONGO_URI. No external host fallback.
  // External Mongo was removed: database-name checks alone cannot prove host ownership,
  // and collection-wide deletes on a shared host remain destructive.
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    const uri = memoryServer.getUri(SUITE_DB_NAME);
    await mongoose.connect(uri);
    dbOwnership = 'memory';
    return;
  } catch (err) {
    setupError = `MongoMemoryServer required for messaging integration tests (${err.message})`;
    throw new Error(setupError);
  }
}

async function safeCleanupDatabase() {
  if (mongoose.connection.readyState !== 1) return;
  if (dbOwnership !== 'memory') {
    throw new Error('Refusing cleanup: suite does not own a memory database');
  }
  await mongoose.connection.dropDatabase().catch(() => {});
}

beforeAll(async () => {
  await connectIsolated();
  ({ Conversation, Message } = await import('../../src/modules/conversations/model.js'));
  ({ Notification } = await import('../../src/modules/notifications/model.js'));
  const service = await import('../../src/modules/conversations/service.js');
  createOrGetConversation = service.createOrGetConversation;
  sendMessage = service.sendMessage;
  markConversationRead = service.markConversationRead;
  completeMessageSideEffects = service.completeMessageSideEffects;
  reconcilePendingMessageSideEffects = service.reconcilePendingMessageSideEffects;
  __setMarkReadTestHooks = service.__setMarkReadTestHooks;
  await Conversation.syncIndexes();
  await Message.syncIndexes();
  await Notification.syncIndexes();
}, 120_000);

afterAll(async () => {
  try {
    await safeCleanupDatabase();
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect().catch(() => {});
    }
    if (memoryServer) {
      await memoryServer.stop().catch(() => {});
      memoryServer = null;
    }
  }
});

beforeEach(async () => {
  getMessagingTargetForAd.mockReset();
  getActiveAccountRef.mockReset();
  getActiveAccountRef.mockImplementation(async (id) => ({ _id: id, isActive: true }));
  if (mongoose.connection.readyState === 1) {
    await Promise.all([
      Conversation.deleteMany({}),
      Message.deleteMany({}),
      Notification.deleteMany({}),
    ]);
  }
});

function account(idHex) {
  return { _id: new mongoose.Types.ObjectId(String(idHex).padStart(24, '0')) };
}

describe('mongo integration: database safety', () => {
  test('suite owns an isolated memory database', () => {
    expect(dbOwnership).toBe('memory');
    expect(mongoose.connection.readyState).toBe(1);
  });

  test('URI helper rejects application and non-test database names', () => {
    expect(isAllowedExternalTestUri('mongodb://127.0.0.1:27017/maziwa_smart_v2')).toBe(false);
    expect(isAllowedExternalTestUri('mongodb://127.0.0.1:27017/maziwa_messaging_test')).toBe(true);
    expect(isAllowedExternalTestUri(undefined)).toBe(false);
  });

  test('external Mongo fallback is disabled (memory-only policy)', () => {
    // connectIsolated must not read MONGO_URI or connect to caller-supplied hosts.
    expect(dbOwnership).toBe('memory');
    expect(memoryServer).toBeTruthy();
  });
});

describe('mongo integration: index definitions (low-level)', () => {
  test('conversation unique compound index keys', async () => {
    const indexes = await Conversation.collection.indexes();
    const unique = indexes.filter((i) => i.unique);
    const match = unique.find((i) => i.key.participantKey === 1
      && i.key.contextType === 1
      && Object.prototype.hasOwnProperty.call(i.key, 'livestockAdId'));
    expect(match).toBeTruthy();
    expect(match.unique).toBe(true);
  });

  test('message unique compound index keys', async () => {
    const indexes = await Message.collection.indexes();
    const match = indexes.find((i) => i.unique
      && i.key.conversationId === 1
      && i.key.senderAccountId === 1
      && i.key.clientMessageId === 1);
    expect(match).toBeTruthy();
  });

  test('notification unique compound index keys', async () => {
    const indexes = await Notification.collection.indexes();
    const match = indexes.find((i) => i.unique
      && i.key.recipientAccountId === 1
      && i.key.messageId === 1);
    expect(match).toBeTruthy();
  });
});

describe('mongo integration: real service concurrent conversation create', () => {
  test('createOrGetConversation concurrent duplicates resolve to one conversation', async () => {
    const A = account('a');
    const B = account('b');
    const results = await Promise.all([
      createOrGetConversation(A, { contextType: 'direct', otherAccountId: String(B._id) }),
      createOrGetConversation(A, { contextType: 'direct', otherAccountId: String(B._id) }),
      createOrGetConversation(A, { contextType: 'direct', otherAccountId: String(B._id) }),
    ]);
    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(1);
    const count = await Conversation.countDocuments({
      contextType: 'direct',
      participantAccountIds: A._id,
    });
    expect(count).toBe(1);
  });
});

describe('mongo integration: real service sendMessage idempotency', () => {
  test('same key same body returns existing; different body 409', async () => {
    const A = account('a1');
    const B = account('b1');
    const conv = await createOrGetConversation(A, {
      contextType: 'direct',
      otherAccountId: String(B._id),
    });
    const [m1, m2] = await Promise.all([
      sendMessage(A, conv.id, { body: 'Hello', clientMessageId: 'idem-1' }),
      sendMessage(A, conv.id, { body: 'Hello', clientMessageId: 'idem-1' }),
    ]);
    expect(m1.id).toBe(m2.id);
    const count = await Message.countDocuments({ conversationId: conv.id, clientMessageId: 'idem-1' });
    expect(count).toBe(1);

    await expect(
      sendMessage(A, conv.id, { body: 'Different', clientMessageId: 'idem-1' }),
    ).rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' });
  });
});

describe('mongo integration: real service read cursors', () => {
  test('concurrent first markConversationRead creates a single cursor', async () => {
    const A = account('a2');
    const B = account('b2');
    const conv = await createOrGetConversation(A, {
      contextType: 'direct',
      otherAccountId: String(B._id),
    });
    const msg = await sendMessage(B, conv.id, { body: 'hi', clientMessageId: 'c-first' });

    const results = await Promise.all([
      markConversationRead(A, conv.id, { lastReadMessageId: msg.id }),
      markConversationRead(A, conv.id, { lastReadMessageId: msg.id }),
      markConversationRead(A, conv.id, { lastReadMessageId: msg.id }),
    ]);
    expect(results.every((r) => r.id === conv.id)).toBe(true);
    const doc = await Conversation.findById(conv.id).lean();
    const mine = (doc.readCursors || []).filter((c) => String(c.accountId) === String(A._id));
    expect(mine).toHaveLength(1);
    expect(String(mine[0].lastReadMessageId)).toBe(String(msg.id));
  });

  test('overlapping advances: older cannot regress newer cursor', async () => {
    const A = account('a3');
    const B = account('b3');
    const conv = await createOrGetConversation(A, {
      contextType: 'direct',
      otherAccountId: String(B._id),
    });
    const older = await sendMessage(B, conv.id, { body: 'old', clientMessageId: 'old-1' });
    // Ensure distinct ordering
    await new Promise((r) => setTimeout(r, 5));
    const newer = await sendMessage(B, conv.id, { body: 'new', clientMessageId: 'new-1' });

    // Start both advances nearly together: newer should win; older must not leave final state older.
    await Promise.all([
      markConversationRead(A, conv.id, { lastReadMessageId: newer.id }),
      markConversationRead(A, conv.id, { lastReadMessageId: older.id }),
      markConversationRead(A, conv.id, { lastReadMessageId: newer.id }),
    ]);

    const doc = await Conversation.findById(conv.id).lean();
    const mine = doc.readCursors.find((c) => String(c.accountId) === String(A._id));
    expect(String(mine.lastReadMessageId)).toBe(String(newer.id));
  });
});

describe('mongo integration: listing published vs closed via real service', () => {
  test('new listing conversation requires published; existing reusable when closed', async () => {
    const A = account('a4');
    const B = account('b4');
    const adId = new mongoose.Types.ObjectId();

    getMessagingTargetForAd.mockResolvedValue({
      adId: String(adId),
      status: 'published',
      advertiserAccountId: String(B._id),
      title: 'Cow',
    });
    const open = await createOrGetConversation(A, {
      contextType: 'livestock_ad',
      livestockAdId: String(adId),
    });

    getMessagingTargetForAd.mockResolvedValue({
      adId: String(adId),
      status: 'closed',
      advertiserAccountId: String(B._id),
      title: 'Cow',
    });
    const again = await createOrGetConversation(A, {
      contextType: 'livestock_ad',
      livestockAdId: String(adId),
    });
    expect(again.id).toBe(open.id);

    // No existing: closed rejects create
    const otherAd = new mongoose.Types.ObjectId();
    getMessagingTargetForAd.mockResolvedValue({
      adId: String(otherAd),
      status: 'archived',
      advertiserAccountId: String(B._id),
      title: 'X',
    });
    await expect(createOrGetConversation(A, {
      contextType: 'livestock_ad',
      livestockAdId: String(otherAd),
    })).rejects.toMatchObject({ code: 'LIVESTOCK_AD_NOT_PUBLISHED' });
  });
});

describe('mongo integration: side effects and recovery', () => {
  test('notification uniqueness and completeMessageSideEffects recovery', async () => {
    const A = account('a5');
    const B = account('b5');
    const conv = await createOrGetConversation(A, {
      contextType: 'direct',
      otherAccountId: String(B._id),
    });
    const msg = await sendMessage(A, conv.id, { body: 'Ping', clientMessageId: 'n-1' });
    // Side effects may already complete during send; re-run must stay idempotent
    await completeMessageSideEffects(msg.id);
    await completeMessageSideEffects(msg.id);
    const nCount = await Notification.countDocuments({
      recipientAccountId: B._id,
      messageId: msg.id,
    });
    expect(nCount).toBe(1);
    const fresh = await Message.findById(msg.id).lean();
    expect(fresh.sideEffectsStatus).toBe('completed');
  });

  test('reconcile skips future nextAttemptAt so later records can progress', async () => {
    const A = account('a6');
    const B = account('b6');
    const conv = await createOrGetConversation(A, {
      contextType: 'direct',
      otherAccountId: String(B._id),
    });
    // Insert a stuck pending message with future backoff and a due pending message
    const stuck = await Message.create({
      conversationId: conv.id,
      senderAccountId: A._id,
      body: 'stuck',
      clientMessageId: 'stuck-1',
      sideEffectsStatus: 'pending',
      sideEffectsAttempts: 3,
      sideEffectsNextAttemptAt: new Date(Date.now() + 60_000),
    });
    const due = await Message.create({
      conversationId: conv.id,
      senderAccountId: A._id,
      body: 'due',
      clientMessageId: 'due-1',
      sideEffectsStatus: 'pending',
      sideEffectsAttempts: 0,
      sideEffectsNextAttemptAt: null,
    });
    const result = await reconcilePendingMessageSideEffects({ limit: 10 });
    expect(result.scanned).toBeGreaterThanOrEqual(1);
    const stuckFresh = await Message.findById(stuck._id).lean();
    const dueFresh = await Message.findById(due._id).lean();
    expect(stuckFresh.sideEffectsStatus).toBe('pending');
    expect(dueFresh.sideEffectsStatus).toBe('completed');
  });
});

describe('mongo integration: deterministic cursor concurrency (real service)', () => {
  afterEach(() => {
    if (__setMarkReadTestHooks) __setMarkReadTestHooks(null);
  });

  test('first-cursor races produce a single cursor per account', async () => {
    const A = account('c1a');
    const B = account('c1b');
    const conv = await createOrGetConversation(A, {
      contextType: 'direct', otherAccountId: String(B._id),
    });
    const msg = await sendMessage(B, conv.id, { body: 'hi', clientMessageId: 'fc-1' });
    await Promise.all([
      markConversationRead(A, conv.id, { lastReadMessageId: msg.id }),
      markConversationRead(A, conv.id, { lastReadMessageId: msg.id }),
      markConversationRead(A, conv.id, { lastReadMessageId: msg.id }),
    ]);
    const doc = await Conversation.findById(conv.id).lean();
    const mine = (doc.readCursors || []).filter((c) => String(c.accountId) === String(A._id));
    expect(mine).toHaveLength(1);
  });

  test('from same old cursor: concurrent mid and newer ends at newer', async () => {
    const A = account('c2a');
    const B = account('c2b');
    const conv = await createOrGetConversation(A, {
      contextType: 'direct', otherAccountId: String(B._id),
    });
    const older = await sendMessage(B, conv.id, { body: 'o', clientMessageId: 'c2-o' });
    await new Promise((r) => setTimeout(r, 5));
    const mid = await sendMessage(B, conv.id, { body: 'm', clientMessageId: 'c2-m' });
    await new Promise((r) => setTimeout(r, 5));
    const newer = await sendMessage(B, conv.id, { body: 'n', clientMessageId: 'c2-n' });
    await markConversationRead(A, conv.id, { lastReadMessageId: older.id });
    await Promise.all([
      markConversationRead(A, conv.id, { lastReadMessageId: mid.id }),
      markConversationRead(A, conv.id, { lastReadMessageId: newer.id }),
    ]);
    const doc = await Conversation.findById(conv.id).lean();
    const mine = doc.readCursors.find((c) => String(c.accountId) === String(A._id));
    expect(String(mine.lastReadMessageId)).toBe(String(newer.id));
  });

  test('older request cannot regress after newer is applied', async () => {
    const A = account('c3a');
    const B = account('c3b');
    const conv = await createOrGetConversation(A, {
      contextType: 'direct', otherAccountId: String(B._id),
    });
    const older = await sendMessage(B, conv.id, { body: 'o', clientMessageId: 'c3-o' });
    await new Promise((r) => setTimeout(r, 5));
    const newer = await sendMessage(B, conv.id, { body: 'n', clientMessageId: 'c3-n' });
    await markConversationRead(A, conv.id, { lastReadMessageId: newer.id });
    await markConversationRead(A, conv.id, { lastReadMessageId: older.id });
    const doc = await Conversation.findById(conv.id).lean();
    const mine = doc.readCursors.find((c) => String(c.accountId) === String(A._id));
    expect(String(mine.lastReadMessageId)).toBe(String(newer.id));
  });

  test('forced CAS misses exhaust and return READ_CURSOR_CONFLICT when unapplied', async () => {
    const A = account('c4a');
    const B = account('c4b');
    const conv = await createOrGetConversation(A, {
      contextType: 'direct', otherAccountId: String(B._id),
    });
    const older = await sendMessage(B, conv.id, { body: 'o', clientMessageId: 'c4-o' });
    await new Promise((r) => setTimeout(r, 5));
    const newer = await sendMessage(B, conv.id, { body: 'n', clientMessageId: 'c4-n' });
    await markConversationRead(A, conv.id, { lastReadMessageId: older.id });
    __setMarkReadTestHooks({ forceCasMiss: true });
    await expect(markConversationRead(A, conv.id, { lastReadMessageId: newer.id }))
      .rejects.toMatchObject({ code: 'READ_CURSOR_CONFLICT', status: 409 });
    const doc = await Conversation.findById(conv.id).lean();
    const mine = doc.readCursors.find((c) => String(c.accountId) === String(A._id));
    expect(String(mine.lastReadMessageId)).toBe(String(older.id));
  });

  test('retry exhaustion succeeds when another writer advances persisted cursor past the request', async () => {
    const A = account('c5a');
    const B = account('c5b');
    const conv = await createOrGetConversation(A, {
      contextType: 'direct', otherAccountId: String(B._id),
    });
    const older = await sendMessage(B, conv.id, { body: 'o', clientMessageId: 'c5-o' });
    await new Promise((r) => setTimeout(r, 5));
    const mid = await sendMessage(B, conv.id, { body: 'm', clientMessageId: 'c5-m' });
    await new Promise((r) => setTimeout(r, 5));
    const newer = await sendMessage(B, conv.id, { body: 'n', clientMessageId: 'c5-n' });
    await markConversationRead(A, conv.id, { lastReadMessageId: older.id });

    let casMisses = 0;
    __setMarkReadTestHooks({
      forceCasMiss: true,
      onCasMiss: async () => {
        casMisses += 1;
        if (casMisses === 6) {
          const update = await Conversation.updateOne(
            { _id: conv.id, 'readCursors.accountId': A._id },
            {
              $set: {
                'readCursors.$.lastReadMessageId': newer.id,
                'readCursors.$.lastReadAt': new Date(),
              },
            },
          );
          expect(update.matchedCount).toBe(1);
          expect(update.modifiedCount).toBe(1);
          const persisted = await Conversation.findById(conv.id).lean();
          const persistedCursor = persisted.readCursors.find(
            (cursor) => String(cursor.accountId) === String(A._id),
          );
          expect(String(persistedCursor.lastReadMessageId)).toBe(String(newer.id));
        }
      },
    });

    const result = await markConversationRead(A, conv.id, { lastReadMessageId: mid.id });
    expect(casMisses).toBe(6);
    expect(result.id).toBe(conv.id);

    const doc = await Conversation.findById(conv.id).lean();
    const mine = doc.readCursors.find((c) => String(c.accountId) === String(A._id));
    expect(String(mine.lastReadMessageId)).toBe(String(newer.id));
  });

});
