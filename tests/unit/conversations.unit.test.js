import { jest } from '@jest/globals';
import mongoose from 'mongoose';

const getMessagingTargetForAd = jest.fn();
const getActiveAccountRef = jest.fn();
const conversationStore = new Map();
const messageStore = new Map();
const notificationStore = new Map();

function oid(hex) {
  return new mongoose.Types.ObjectId(String(hex).padStart(24, '0'));
}

jest.unstable_mockModule('../../src/modules/livestock-marketplace/service.js', () => ({ getMessagingTargetForAd }));
jest.unstable_mockModule('../../src/modules/identity/service.js', () => ({ getActiveAccountRef }));

jest.unstable_mockModule('../../src/modules/conversations/model.js', () => {
  const Conversation = {
    findOne: jest.fn(async (filter) => {
      for (const d of conversationStore.values()) {
        if (d.participantKey === filter.participantKey
          && d.contextType === filter.contextType
          && String(d.livestockAdId || null) === String(filter.livestockAdId || null)) return d;
      }
      return null;
    }),
    findById: jest.fn((id) => {
      const doc = conversationStore.get(String(id)) || null;
      const query = {
        select() { return query; },
        lean() { return Promise.resolve(doc ? { ...doc } : null); },
        then(resolve, reject) { return Promise.resolve(doc).then(resolve, reject); },
      };
      return query;
    }),
    find: jest.fn(() => ({ sort: () => ({ lean: async () => [] }) })),
    create: jest.fn(async (data) => {
      const _id = new mongoose.Types.ObjectId();
      const doc = { _id, readCursors: [], ...data };
      conversationStore.set(String(_id), doc);
      return doc;
    }),
    updateOne: jest.fn(async (filter, update) => {
      const doc = conversationStore.get(String(filter._id));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$push?.readCursors) {
        const exists = (doc.readCursors || []).some(
          (c) => String(c.accountId) === String(update.$push.readCursors.accountId),
        );
        if (exists || (filter['readCursors.accountId']?.$ne
          && (doc.readCursors || []).some((c) => String(c.accountId) === String(filter['readCursors.accountId'].$ne)))) {
          return { matchedCount: 0, modifiedCount: 0 };
        }
        doc.readCursors = doc.readCursors || [];
        doc.readCursors.push({ ...update.$push.readCursors });
        return { matchedCount: 1, modifiedCount: 1 };
      }
      if (filter.readCursors?.$elemMatch) {
        const em = filter.readCursors.$elemMatch;
        const idx = (doc.readCursors || []).findIndex(
          (c) => String(c.accountId) === String(em.accountId)
            && String(c.lastReadMessageId) === String(em.lastReadMessageId),
        );
        if (idx < 0) return { matchedCount: 0, modifiedCount: 0 };
        if (update.$set) {
          for (const [k, v] of Object.entries(update.$set)) {
            doc.readCursors[idx][k.replace('readCursors.$.', '')] = v;
          }
        }
        return { matchedCount: 1, modifiedCount: 1 };
      }
      if (update.$set) Object.assign(doc, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    }),
  };
  const Message = {
    create: jest.fn(async (data) => {
      for (const m of messageStore.values()) {
        if (String(m.conversationId) === String(data.conversationId)
          && String(m.senderAccountId) === String(data.senderAccountId)
          && m.clientMessageId === data.clientMessageId) {
          const e = new Error('dup'); e.code = 11000; throw e;
        }
      }
      const _id = new mongoose.Types.ObjectId();
      const doc = { _id, createdAt: data.createdAt || new Date(), sideEffectsAttempts: 0, ...data };
      messageStore.set(String(_id), doc);
      return doc;
    }),
    findOne: jest.fn(async (f) => {
      for (const m of messageStore.values()) {
        if (String(m.conversationId) === String(f.conversationId)
          && String(m.senderAccountId) === String(f.senderAccountId)
          && m.clientMessageId === f.clientMessageId) return m;
      }
      return null;
    }),
    findById: jest.fn((id) => {
      const doc = messageStore.get(String(id)) || null;
      const query = {
        select() { return query; },
        lean() { return Promise.resolve(doc ? { ...doc } : null); },
        then(resolve, reject) { return Promise.resolve(doc).then(resolve, reject); },
      };
      return query;
    }),
    find: jest.fn((filter) => {
      let rows = [...messageStore.values()].filter((m) => {
        if (filter.sideEffectsStatus && m.sideEffectsStatus !== filter.sideEffectsStatus) return false;
        if (filter.$or && filter.sideEffectsStatus === 'pending') {
          // due for retry
          const now = new Date();
          const due = !m.sideEffectsNextAttemptAt || m.sideEffectsNextAttemptAt <= now;
          if (!due) return false;
        }
        return true;
      });
      return {
        sort: () => ({
          limit: (n) => ({
            select: async () => rows.slice(0, n).map((m) => ({ _id: m._id })),
            lean: async () => rows.slice(0, n),
          }),
        }),
      };
    }),
    countDocuments: jest.fn(async () => 0),
    updateOne: jest.fn(async (f, u) => {
      const m = messageStore.get(String(f._id));
      if (!m) return { matchedCount: 0 };
      if (f.sideEffectsStatus && m.sideEffectsStatus !== f.sideEffectsStatus) return { matchedCount: 0 };
      if (u.$set) Object.assign(m, u.$set);
      if (u.$inc) for (const [k, v] of Object.entries(u.$inc)) m[k] = (m[k] || 0) + v;
      return { matchedCount: 1 };
    }),
  };
  return {
    Conversation, Message,
    CONVERSATION_CONTEXTS: ['direct', 'livestock_ad'],
    MESSAGE_SIDE_EFFECT_STATUSES: ['pending', 'completed'],
  };
});

jest.unstable_mockModule('../../src/modules/notifications/model.js', () => ({
  Notification: {
    create: jest.fn(async (data) => {
      const key = `${data.recipientAccountId}|${data.messageId}`;
      if (notificationStore.has(key)) {
        const e = new Error('d'); e.code = 11000; throw e;
      }
      notificationStore.set(key, data);
      return data;
    }),
  },
}));

const {
  createOrGetConversation,
  sendMessage,
  markConversationRead,
  completeMessageSideEffects,
  reconcilePendingMessageSideEffects,
  messageOrderLess,
  __setMarkReadTestHooks,
} = await import('../../src/modules/conversations/service.js');
const { Message, Conversation } = await import('../../src/modules/conversations/model.js');
const { parseHistoryQuery } = await import('../../src/modules/conversations/validation.js');

const A = { _id: oid('a') };
const B = { _id: oid('b') };
const C = { _id: oid('c') };
const AD1 = oid('ad1');

beforeEach(() => {
  jest.clearAllMocks();
  conversationStore.clear();
  messageStore.clear();
  notificationStore.clear();
  getActiveAccountRef.mockImplementation(async (id) => ({ _id: id, isActive: true }));
  getMessagingTargetForAd.mockImplementation(async (adId) => ({
    adId: String(adId), status: 'published', advertiserAccountId: String(B._id), title: 'Ad',
  }));
});

describe('unit: closed-ad reuse and published create', () => {
  test('reuses existing listing conversation after ad closes', async () => {
    const open = await createOrGetConversation(A, { contextType: 'livestock_ad', livestockAdId: String(AD1) });
    getMessagingTargetForAd.mockResolvedValue({
      adId: String(AD1), status: 'closed', advertiserAccountId: String(B._id), title: 'Closed',
    });
    const again = await createOrGetConversation(A, { contextType: 'livestock_ad', livestockAdId: String(AD1) });
    expect(again.id).toBe(open.id);
  });

  test('refuses new listing conversation for closed ad', async () => {
    getMessagingTargetForAd.mockResolvedValue({
      adId: String(AD1), status: 'closed', advertiserAccountId: String(B._id), title: 'Closed',
    });
    await expect(createOrGetConversation(A, { contextType: 'livestock_ad', livestockAdId: String(AD1) }))
      .rejects.toMatchObject({ code: 'LIVESTOCK_AD_NOT_PUBLISHED' });
  });

  test('recipient is advertiser; self-message rejected', async () => {
    getMessagingTargetForAd.mockResolvedValueOnce({
      adId: String(AD1), status: 'published', advertiserAccountId: String(A._id), title: 'mine',
    });
    await expect(createOrGetConversation(A, { contextType: 'livestock_ad', livestockAdId: String(AD1) }))
      .rejects.toMatchObject({ code: 'CANNOT_MESSAGE_SELF' });
  });
});

describe('unit: idempotency and authz', () => {
  test('same key same body; different body 409; non-participant 403', async () => {
    const c = await createOrGetConversation(A, { contextType: 'direct', otherAccountId: String(B._id) });
    const m1 = await sendMessage(A, c.id, { body: 'Hi', clientMessageId: 'k1' });
    const m2 = await sendMessage(A, c.id, { body: 'Hi', clientMessageId: 'k1' });
    expect(m1.id).toBe(m2.id);
    await expect(sendMessage(A, c.id, { body: 'Other', clientMessageId: 'k1' }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
    await expect(sendMessage(C, c.id, { body: 'x', clientMessageId: 'z' }))
      .rejects.toMatchObject({ status: 403 });
  });
});

describe('unit: read cursor ordering and missing-message repair', () => {
  test('messageOrderLess uses (createdAt, _id)', () => {
    const t = new Date('2024-01-01');
    expect(messageOrderLess(t, oid('1'), t, oid('2'))).toBe(true);
    expect(messageOrderLess(t, oid('2'), t, oid('1'))).toBe(false);
  });

  test('cursor does not regress when older message applied after newer', async () => {
    const conv = await createOrGetConversation(A, { contextType: 'direct', otherAccountId: String(B._id) });
    const t0 = new Date('2024-03-01T00:00:00.000Z');
    const older = await Message.create({
      conversationId: conv.id, senderAccountId: B._id, body: 'old', clientMessageId: 'o1',
      sideEffectsStatus: 'completed', createdAt: t0,
    });
    const newer = await Message.create({
      conversationId: conv.id, senderAccountId: B._id, body: 'new', clientMessageId: 'o2',
      sideEffectsStatus: 'completed', createdAt: new Date(t0.getTime() + 5000),
    });
    await markConversationRead(A, conv.id, { lastReadMessageId: String(newer._id) });
    await markConversationRead(A, conv.id, { lastReadMessageId: String(older._id) });
    const cursors = conversationStore.get(conv.id).readCursors;
    const mine = cursors.find((c) => String(c.accountId) === String(A._id));
    expect(String(mine.lastReadMessageId)).toBe(String(newer._id));
  });

  test('missing previous cursor message is repaired via CAS', async () => {
    const conv = await createOrGetConversation(A, { contextType: 'direct', otherAccountId: String(B._id) });
    const ghostId = new mongoose.Types.ObjectId();
    const doc = conversationStore.get(conv.id);
    doc.readCursors = [{ accountId: A._id, lastReadMessageId: ghostId, lastReadAt: new Date() }];
    const msg = await Message.create({
      conversationId: conv.id, senderAccountId: B._id, body: 'alive', clientMessageId: 'alive1',
      sideEffectsStatus: 'completed', createdAt: new Date(),
    });
    await markConversationRead(A, conv.id, { lastReadMessageId: String(msg._id) });
    const mine = conversationStore.get(conv.id).readCursors.find((c) => String(c.accountId) === String(A._id));
    expect(String(mine.lastReadMessageId)).toBe(String(msg._id));
  });
});

describe('unit: recovery backoff and integrity', () => {
  test('missing conversation leaves pending and schedules next attempt', async () => {
    const id = new mongoose.Types.ObjectId();
    messageStore.set(String(id), {
      _id: id,
      conversationId: new mongoose.Types.ObjectId(),
      senderAccountId: A._id,
      body: 'x',
      clientMessageId: 'orph',
      sideEffectsStatus: 'pending',
      sideEffectsAttempts: 0,
    });
    Message.findById.mockResolvedValueOnce(messageStore.get(String(id)));
    Conversation.findById.mockResolvedValueOnce(null);
    const result = await completeMessageSideEffects(id);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('conversation_missing');
    const m = messageStore.get(String(id));
    expect(m.sideEffectsStatus).toBe('pending');
    expect(m.sideEffectsNextAttemptAt).toBeInstanceOf(Date);
  });

  test('rejects both before and after cursors', () => {
    expect(() => parseHistoryQuery({ before: String(oid('1')), after: String(oid('2')) }))
      .toThrow(/before or after/i);
  });
});


describe('unit: read cursor retry exhaustion', () => {
  afterEach(() => {
    __setMarkReadTestHooks(null);
  });

  test('exhaustion returns conflict when requested advance is still unapplied', async () => {
    const conv = await createOrGetConversation(A, { contextType: 'direct', otherAccountId: String(B._id) });
    const t0 = new Date('2024-04-01T00:00:00.000Z');
    const older = await Message.create({
      conversationId: conv.id, senderAccountId: B._id, body: 'o', clientMessageId: 'ex-o',
      sideEffectsStatus: 'completed', createdAt: t0,
    });
    const newer = await Message.create({
      conversationId: conv.id, senderAccountId: B._id, body: 'n', clientMessageId: 'ex-n',
      sideEffectsStatus: 'completed', createdAt: new Date(t0.getTime() + 5000),
    });
    // Seed cursor at older
    conversationStore.get(conv.id).readCursors = [
      { accountId: A._id, lastReadMessageId: older._id, lastReadAt: new Date() },
    ];
    // Force every CAS to miss → depth exhausts with cursor still on older while requesting newer
    __setMarkReadTestHooks({ forceCasMiss: true });
    await expect(markConversationRead(A, conv.id, { lastReadMessageId: String(newer._id) }))
      .rejects.toMatchObject({ code: 'READ_CURSOR_CONFLICT', status: 409 });
    const cursor = conversationStore.get(conv.id).readCursors.find((c) => String(c.accountId) === String(A._id));
    expect(String(cursor.lastReadMessageId)).toBe(String(older._id));
  });

  test('exhaustion succeeds when a concurrent writer advances past the request', async () => {
    const conv = await createOrGetConversation(A, { contextType: 'direct', otherAccountId: String(B._id) });
    const t0 = new Date('2024-05-01T00:00:00.000Z');
    const older = await Message.create({
      conversationId: conv.id, senderAccountId: B._id, body: 'o2', clientMessageId: 'ex2-o',
      sideEffectsStatus: 'completed', createdAt: t0,
    });
    const mid = await Message.create({
      conversationId: conv.id, senderAccountId: B._id, body: 'm2', clientMessageId: 'ex2-m',
      sideEffectsStatus: 'completed', createdAt: new Date(t0.getTime() + 3000),
    });
    const newer = await Message.create({
      conversationId: conv.id, senderAccountId: B._id, body: 'n2', clientMessageId: 'ex2-n',
      sideEffectsStatus: 'completed', createdAt: new Date(t0.getTime() + 6000),
    });
    conversationStore.get(conv.id).readCursors = [
      { accountId: A._id, lastReadMessageId: older._id, lastReadAt: new Date() },
    ];

    let casMisses = 0;
    __setMarkReadTestHooks({
      forceCasMiss: true,
      onCasMiss: () => {
        casMisses += 1;
        if (casMisses === 6) {
          conversationStore.get(conv.id).readCursors[0].lastReadMessageId = newer._id;
        }
      },
    });

    const result = await markConversationRead(A, conv.id, {
      lastReadMessageId: String(mid._id),
    });
    expect(casMisses).toBe(6);
    expect(result.id).toBe(conv.id);
    const cursor = conversationStore.get(conv.id).readCursors.find(
      (c) => String(c.accountId) === String(A._id),
    );
    expect(String(cursor.lastReadMessageId)).toBe(String(newer._id));
  });
});
