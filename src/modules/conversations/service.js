import mongoose from 'mongoose';
import { Conversation, Message } from './model.js';
import { Notification } from '../notifications/model.js';
import { AppError } from '../../shared/errors/AppError.js';
import * as marketplaceService from '../livestock-marketplace/service.js';
import * as identityService from '../identity/service.js';
import {
  assertObjectId,
  normalizeMessageBody,
  normalizeClientMessageId,
  parseCreateConversationInput,
  parseHistoryQuery,
  canonicalParticipantKey,
} from './validation.js';


/** @type {{ forceCasMiss?: boolean, casMissCount?: number, onCasMiss?: () => void | Promise<void> } | null} */
let __markReadTestHooks = null;
/** Test-only seam for deterministic CAS/retry coverage. Not for production use. */
export function __setMarkReadTestHooks(hooks) {
  __markReadTestHooks = hooks;
}

async function conversationUpdateOne(filter, update) {
  if (__markReadTestHooks?.forceCasMiss) {
    const remaining = __markReadTestHooks.casMissCount;
    if (remaining === undefined || remaining > 0) {
      if (typeof remaining === 'number') __markReadTestHooks.casMissCount = remaining - 1;
      if (typeof __markReadTestHooks.onCasMiss === 'function') {
        await __markReadTestHooks.onCasMiss();
      }
      return { matchedCount: 0, modifiedCount: 0 };
    }
  }
  return Conversation.updateOne(filter, update);
}

function isDuplicateKey(error) {
  return Boolean(error && (error.code === 11000 || error.code === 11001));
}

function toObjectId(value) {
  return new mongoose.Types.ObjectId(String(value));
}

function isParticipant(conversation, accountId) {
  const id = String(accountId);
  return (conversation.participantAccountIds || []).some((p) => String(p) === id);
}

function messageOrderLess(aCreatedAt, aId, bCreatedAt, bId) {
  const at = new Date(aCreatedAt).getTime();
  const bt = new Date(bCreatedAt).getTime();
  if (at !== bt) return at < bt;
  return String(aId) < String(bId);
}

function publicConversation(doc, accountId) {
  if (!doc) return null;
  const other = (doc.participantAccountIds || []).map((p) => String(p)).find((id) => id !== String(accountId));
  const cursor = (doc.readCursors || []).find((c) => String(c.accountId) === String(accountId));
  return {
    id: String(doc._id),
    contextType: doc.contextType,
    livestockAdId: doc.livestockAdId ? String(doc.livestockAdId) : null,
    participantAccountIds: (doc.participantAccountIds || []).map((p) => String(p)),
    otherAccountId: other || null,
    createdByAccountId: String(doc.createdByAccountId),
    lastMessageAt: doc.lastMessageAt || null,
    lastMessageId: doc.lastMessageId ? String(doc.lastMessageId) : null,
    lastMessagePreview: doc.lastMessagePreview || '',
    lastMessageSenderAccountId: doc.lastMessageSenderAccountId ? String(doc.lastMessageSenderAccountId) : null,
    myLastReadMessageId: cursor?.lastReadMessageId ? String(cursor.lastReadMessageId) : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function publicMessage(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    conversationId: String(doc.conversationId),
    senderAccountId: String(doc.senderAccountId),
    body: doc.body,
    clientMessageId: doc.clientMessageId,
    createdAt: doc.createdAt,
  };
}

function previewFromBody(body) {
  const text = String(body || '');
  return text.length <= 280 ? text : `${text.slice(0, 277)}...`;
}

async function loadConversationForAccount(conversationId, accountId) {
  const id = assertObjectId(conversationId, 'INVALID_CONVERSATION_ID', 'conversation id is required');
  const conversation = await Conversation.findById(id);
  if (!conversation) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
  if (!isParticipant(conversation, accountId)) {
    throw new AppError(403, 'FORBIDDEN', 'You are not a participant in this conversation');
  }
  return conversation;
}

/**
 * Create-or-get conversation.
 * For livestock_ad: existing threads are returned even if the ad later closes/archives.
 * New listing conversations require a published ad. Recipient = advertiserAccountId only.
 */
export async function createOrGetConversation(account, input) {
  const parsed = parseCreateConversationInput(input);
  const actorId = toObjectId(account._id);

  let otherId;
  let livestockAdId = null;
  let target = null;

  if (parsed.contextType === 'livestock_ad') {
    // Always resolve ad existence first (404 if missing).
    target = await marketplaceService.getMessagingTargetForAd(parsed.livestockAdId);
    otherId = toObjectId(target.advertiserAccountId);
    livestockAdId = toObjectId(target.adId);

    if (String(otherId) === String(actorId)) {
      throw new AppError(400, 'CANNOT_MESSAGE_SELF', 'You cannot start a conversation with yourself');
    }

    const participantKey = canonicalParticipantKey(actorId, otherId);
    const existingFilter = {
      participantKey,
      contextType: 'livestock_ad',
      livestockAdId,
    };
    // Reuse existing conversation BEFORE published-only gate (closed/archived ads).
    const existing = await Conversation.findOne(existingFilter);
    if (existing) {
      return publicConversation(existing, actorId);
    }

    if (target.status !== 'published') {
      throw new AppError(
        400,
        'LIVESTOCK_AD_NOT_PUBLISHED',
        'New listing conversations require a published advertisement',
      );
    }
  } else {
    otherId = toObjectId(parsed.otherAccountId);
    if (String(otherId) === String(actorId)) {
      throw new AppError(400, 'CANNOT_MESSAGE_SELF', 'You cannot start a conversation with yourself');
    }
    const other = await identityService.getActiveAccountRef(String(otherId));
    if (!other) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Other account not found or inactive');
  }

  const participantKey = canonicalParticipantKey(actorId, otherId);
  const participantAccountIds = String(actorId) < String(otherId) ? [actorId, otherId] : [otherId, actorId];
  const filter = {
    participantKey,
    contextType: parsed.contextType,
    livestockAdId: parsed.contextType === 'livestock_ad' ? livestockAdId : null,
  };

  let conversation = await Conversation.findOne(filter);
  if (conversation) return publicConversation(conversation, actorId);

  try {
    conversation = await Conversation.create({
      ...filter,
      participantAccountIds,
      createdByAccountId: actorId,
      readCursors: [],
    });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    conversation = await Conversation.findOne(filter);
    if (!conversation) throw error;
  }
  return publicConversation(conversation, actorId);
}

export async function listConversations(account) {
  const accountId = account._id;
  const rows = await Conversation.find({ participantAccountIds: accountId })
    .sort({ lastMessageAt: -1, updatedAt: -1 })
    .lean();
  const result = [];
  for (const row of rows) {
    const dto = publicConversation(row, accountId);
    const filter = { conversationId: row._id, senderAccountId: { $ne: accountId } };
    const cursor = (row.readCursors || []).find((c) => String(c.accountId) === String(accountId));
    if (cursor?.lastReadMessageId) {
      const lastRead = await Message.findById(cursor.lastReadMessageId).select('createdAt').lean();
      if (lastRead) {
        filter.$or = [
          { createdAt: { $gt: lastRead.createdAt } },
          { createdAt: lastRead.createdAt, _id: { $gt: cursor.lastReadMessageId } },
        ];
      }
    }
    const unreadCount = await Message.countDocuments(filter);
    result.push({ ...dto, unreadCount });
  }
  return result;
}

export async function getConversation(account, conversationId) {
  const conversation = await loadConversationForAccount(conversationId, account._id);
  return publicConversation(conversation, account._id);
}

/**
 * Paginated history.
 * - before: nearest earlier page (sort desc, limit, reverse to chronological)
 * - after: nearest later page (sort asc, limit, chronological — do not reverse)
 * - both before and after: rejected (400)
 */
export async function listMessages(account, conversationId, query = {}) {
  const conversation = await loadConversationForAccount(conversationId, account._id);
  const { limit, before, after } = parseHistoryQuery(query);

  if (before && after) {
    throw new AppError(400, 'INVALID_CURSOR_RANGE', 'Specify only one of before or after');
  }

  const filter = { conversationId: conversation._id };

  if (before) {
    const anchor = await Message.findById(before).select('createdAt conversationId').lean();
    if (!anchor || String(anchor.conversationId) !== String(conversation._id)) {
      throw new AppError(400, 'INVALID_CURSOR', 'before cursor is not in this conversation');
    }
    filter.$or = [
      { createdAt: { $lt: anchor.createdAt } },
      { createdAt: anchor.createdAt, _id: { $lt: anchor._id } },
    ];
    const rows = await Message.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
    rows.reverse();
    return { conversationId: String(conversation._id), messages: rows.map(publicMessage), limit };
  }

  if (after) {
    const anchor = await Message.findById(after).select('createdAt conversationId').lean();
    if (!anchor || String(anchor.conversationId) !== String(conversation._id)) {
      throw new AppError(400, 'INVALID_CURSOR', 'after cursor is not in this conversation');
    }
    filter.$or = [
      { createdAt: { $gt: anchor.createdAt } },
      { createdAt: anchor.createdAt, _id: { $gt: anchor._id } },
    ];
    // Ascending: nearest page after the cursor; already chronological.
    const rows = await Message.find(filter).sort({ createdAt: 1, _id: 1 }).limit(limit).lean();
    return { conversationId: String(conversation._id), messages: rows.map(publicMessage), limit };
  }

  // Default: latest page in chronological order (most recent `limit` messages).
  const rows = await Message.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
  rows.reverse();
  return { conversationId: String(conversation._id), messages: rows.map(publicMessage), limit };
}

export async function applyConversationSummary(conversationId, message) {
  const preview = previewFromBody(message.body);
  await Conversation.updateOne(
    {
      _id: conversationId,
      $or: [
        { lastMessageAt: null },
        { lastMessageAt: { $lt: message.createdAt } },
        { lastMessageAt: message.createdAt, $or: [{ lastMessageId: null }, { lastMessageId: { $lt: message._id } }] },
      ],
    },
    {
      $set: {
        lastMessageAt: message.createdAt,
        lastMessageId: message._id,
        lastMessagePreview: preview,
        lastMessageSenderAccountId: message.senderAccountId,
      },
    },
  );
}

export async function ensureMessageNotification(message, recipientAccountId) {
  const preview = previewFromBody(message.body);
  try {
    await Notification.create({
      recipientAccountId,
      messageId: message._id,
      conversationId: message.conversationId,
      type: 'message',
      title: 'New message',
      body: preview,
    });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }
}

/**
 * Complete pending side effects. Marks completed only when summary + notification succeed.
 * Missing conversation is an integrity failure — leave pending (do not mark completed).
 */
export async function completeMessageSideEffects(messageId) {
  const message = await Message.findById(messageId);
  if (!message) return { ok: false, reason: 'message_missing' };
  if (message.sideEffectsStatus === 'completed') return { ok: true, reason: 'already_completed' };

  const conversation = await Conversation.findById(message.conversationId);
  if (!conversation) {
    const attempts = (message.sideEffectsAttempts || 0) + 1;
    const delayMs = Math.min(60_000, 1000 * (2 ** Math.min(attempts, 6)));
    await Message.updateOne(
      { _id: message._id },
      {
        $inc: { sideEffectsAttempts: 1 },
        $set: { sideEffectsNextAttemptAt: new Date(Date.now() + delayMs) },
      },
    );
    return { ok: false, reason: 'conversation_missing' };
  }

  try {
    await applyConversationSummary(conversation._id, message);
    const recipient = (conversation.participantAccountIds || [])
      .map((p) => String(p))
      .find((id) => id !== String(message.senderAccountId));
    if (recipient) {
      await ensureMessageNotification(message, recipient);
    }
    await Message.updateOne(
      { _id: message._id, sideEffectsStatus: 'pending' },
      {
        $set: { sideEffectsStatus: 'completed', sideEffectsNextAttemptAt: null },
        $inc: { sideEffectsAttempts: 1 },
      },
    );
    return { ok: true, reason: 'completed' };
  } catch (error) {
    const attempts = (message.sideEffectsAttempts || 0) + 1;
    const delayMs = Math.min(60_000, 1000 * (2 ** Math.min(attempts, 6)));
    await Message.updateOne(
      { _id: message._id },
      {
        $inc: { sideEffectsAttempts: 1 },
        $set: { sideEffectsNextAttemptAt: new Date(Date.now() + delayMs) },
      },
    );
    return { ok: false, reason: 'side_effect_error', error: error.message };
  }
}

export async function reconcilePendingMessageSideEffects({ limit = 50, now = new Date() } = {}) {
  const batch = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const pending = await Message.find({
    sideEffectsStatus: 'pending',
    $or: [
      { sideEffectsNextAttemptAt: null },
      { sideEffectsNextAttemptAt: { $exists: false } },
      { sideEffectsNextAttemptAt: { $lte: now } },
    ],
  })
    .sort({ createdAt: 1, _id: 1 })
    .limit(batch)
    .select('_id');
  let completed = 0;
  let failed = 0;
  for (const row of pending) {
    const result = await completeMessageSideEffects(row._id);
    if (result.ok) completed += 1;
    else failed += 1;
  }
  return { scanned: pending.length, completed, failed, limit: batch };
}

export async function sendMessage(account, conversationId, input = {}) {
  const conversation = await loadConversationForAccount(conversationId, account._id);
  const body = normalizeMessageBody(input.body);
  const clientMessageId = normalizeClientMessageId(input.clientMessageId);
  const senderAccountId = toObjectId(account._id);
  let message;
  try {
    message = await Message.create({
      conversationId: conversation._id,
      senderAccountId,
      body,
      clientMessageId,
      sideEffectsStatus: 'pending',
      sideEffectsAttempts: 0,
    });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const existing = await Message.findOne({
      conversationId: conversation._id,
      senderAccountId,
      clientMessageId,
    });
    if (!existing) throw error;
    if (existing.body !== body) {
      throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'clientMessageId was already used with a different message body');
    }
    if (existing.sideEffectsStatus !== 'completed') {
      await completeMessageSideEffects(existing._id);
    }
    return publicMessage(existing);
  }
  try {
    await completeMessageSideEffects(message._id);
  } catch {
    /* message durable; remains pending */
  }
  const fresh = await Message.findById(message._id);
  return publicMessage(fresh || message);
}

/**
 * Atomic read-cursor update. Prevents concurrent regression via conditional update.
 * - No existing cursor: $push if accountId not already present
 * - Existing cursor: update only when new message is strictly newer by (createdAt, _id)
 */
export async function markConversationRead(account, conversationId, input = {}, _depth = 0) {
  if (_depth > 5) {
    const conversation = await loadConversationForAccount(conversationId, account._id);
    const lastReadMessageId = assertObjectId(
      input.lastReadMessageId,
      'INVALID_LAST_READ_MESSAGE_ID',
      'lastReadMessageId is required',
    );
    const requested = await Message.findById(lastReadMessageId).select('createdAt conversationId').lean();
    if (!requested || String(requested.conversationId) !== String(conversation._id)) {
      throw new AppError(400, 'INVALID_LAST_READ_MESSAGE_ID', 'Message is not in this conversation');
    }
    const accountId = String(account._id);
    const existing = (conversation.readCursors || []).find((c) => String(c.accountId) === accountId);
    if (existing?.lastReadMessageId) {
      if (String(existing.lastReadMessageId) === String(requested._id)) {
        return publicConversation(conversation, account._id);
      }
      const prev = await Message.findById(existing.lastReadMessageId).select('createdAt').lean();
      if (prev) {
        // Success if persisted cursor is already strictly after the requested message.
        if (messageOrderLess(requested.createdAt, requested._id, prev.createdAt, existing.lastReadMessageId)) {
          return publicConversation(conversation, account._id);
        }
      }
    }
    throw new AppError(
      409,
      'READ_CURSOR_CONFLICT',
      'Could not apply read cursor update due to concurrent modifications; retry the request',
    );
  }

  const conversation = await loadConversationForAccount(conversationId, account._id);
  const lastReadMessageId = assertObjectId(
    input.lastReadMessageId,
    'INVALID_LAST_READ_MESSAGE_ID',
    'lastReadMessageId is required',
  );

  const message = await Message.findById(lastReadMessageId).select('createdAt conversationId').lean();
  if (!message || String(message.conversationId) !== String(conversation._id)) {
    throw new AppError(400, 'INVALID_LAST_READ_MESSAGE_ID', 'Message is not in this conversation');
  }

  const accountId = toObjectId(account._id);
  const existing = (conversation.readCursors || []).find((c) => String(c.accountId) === String(accountId));

  // Ordering rule: message A is strictly before B iff
  //   A.createdAt < B.createdAt OR (A.createdAt == B.createdAt AND A._id < B._id)

  if (!existing) {
    const pushResult = await conversationUpdateOne(
      {
        _id: conversation._id,
        'readCursors.accountId': { $ne: accountId },
      },
      {
        $push: {
          readCursors: {
            accountId,
            lastReadMessageId: message._id,
            lastReadAt: new Date(),
          },
        },
      },
    );
    if (pushResult.matchedCount === 0) {
      // Lost first-cursor race — re-enter with existing-cursor path.
      return markConversationRead(account, conversationId, input, _depth + 1);
    }
  } else {
    if (String(existing.lastReadMessageId) === String(message._id)) {
      const fresh = await Conversation.findById(conversation._id);
      return publicConversation(fresh, accountId);
    }

    const prev = await Message.findById(existing.lastReadMessageId).select('createdAt').lean();
    if (!prev) {
      // Missing stored cursor message: CAS repair to requested message.
      const repair = await conversationUpdateOne(
        {
          _id: conversation._id,
          readCursors: {
            $elemMatch: {
              accountId,
              lastReadMessageId: existing.lastReadMessageId,
            },
          },
        },
        {
          $set: {
            'readCursors.$.lastReadMessageId': message._id,
            'readCursors.$.lastReadAt': new Date(),
          },
        },
      );
      if (repair.matchedCount === 0) {
        // Another writer moved the cursor; re-evaluate against latest state.
        return markConversationRead(account, conversationId, input, _depth + 1);
      }
    } else if (!messageOrderLess(prev.createdAt, existing.lastReadMessageId, message.createdAt, message._id)) {
      // Requested message is not strictly newer — leave cursor unchanged (no regression).
      const fresh = await Conversation.findById(conversation._id);
      return publicConversation(fresh, accountId);
    } else {
      // Compare-and-set advance. If another concurrent request already advanced the
      // cursor, matchedCount is 0 — re-read and retry so a newer target is not lost
      // behind a middle-value concurrent winner.
      const cas = await conversationUpdateOne(
        {
          _id: conversation._id,
          readCursors: {
            $elemMatch: {
              accountId,
              lastReadMessageId: existing.lastReadMessageId,
            },
          },
        },
        {
          $set: {
            'readCursors.$.lastReadMessageId': message._id,
            'readCursors.$.lastReadAt': new Date(),
          },
        },
      );
      if (cas.matchedCount === 0) {
        return markConversationRead(account, conversationId, input, _depth + 1);
      }
    }
  }

  const fresh = await Conversation.findById(conversation._id);
  return publicConversation(fresh, accountId);
}

export { publicConversation, publicMessage, isParticipant, messageOrderLess };
