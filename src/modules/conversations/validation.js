import mongoose from 'mongoose';
import { AppError } from '../../shared/errors/AppError.js';
import { CONVERSATION_CONTEXTS } from './model.js';

export const MAX_MESSAGE_BODY = 2000;
export const MAX_CLIENT_MESSAGE_ID = 128;
export const MAX_HISTORY_LIMIT = 50;

export function assertObjectId(value, code = 'INVALID_ID', message = 'A valid id is required') {
  const raw = typeof value === 'string' ? value.trim() : String(value || '');
  if (!mongoose.Types.ObjectId.isValid(raw)) throw new AppError(400, code, message);
  return raw;
}

export function normalizeMessageBody(value) {
  if (typeof value !== 'string') throw new AppError(400, 'INVALID_MESSAGE_BODY', 'Message body must be a string');
  const body = value.trim();
  if (!body) throw new AppError(400, 'EMPTY_MESSAGE_BODY', 'Message body must not be empty');
  if (body.length > MAX_MESSAGE_BODY) throw new AppError(400, 'MESSAGE_TOO_LONG', `Message body must be at most ${MAX_MESSAGE_BODY} characters`);
  return body;
}

export function normalizeClientMessageId(value) {
  if (typeof value !== 'string') throw new AppError(400, 'CLIENT_MESSAGE_ID_REQUIRED', 'clientMessageId is required');
  const id = value.trim();
  if (!id) throw new AppError(400, 'CLIENT_MESSAGE_ID_REQUIRED', 'clientMessageId is required');
  if (id.length > MAX_CLIENT_MESSAGE_ID) throw new AppError(400, 'CLIENT_MESSAGE_ID_TOO_LONG', `clientMessageId must be at most ${MAX_CLIENT_MESSAGE_ID} characters`);
  return id;
}

export function parseCreateConversationInput(input = {}) {
  const contextType = typeof input.contextType === 'string' ? input.contextType.trim() : '';
  if (!CONVERSATION_CONTEXTS.includes(contextType)) {
    throw new AppError(400, 'INVALID_CONTEXT_TYPE', 'contextType must be direct or livestock_ad');
  }
  if (contextType === 'livestock_ad') {
    return {
      contextType,
      livestockAdId: assertObjectId(input.livestockAdId, 'INVALID_LIVESTOCK_AD_ID', 'livestockAdId is required'),
      otherAccountId: null,
    };
  }
  return {
    contextType,
    livestockAdId: null,
    otherAccountId: assertObjectId(input.otherAccountId, 'INVALID_OTHER_ACCOUNT_ID', 'otherAccountId is required'),
  };
}

export function parseHistoryQuery(query = {}) {
  let limit = Number.parseInt(String(query.limit ?? '50'), 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 50;
  if (limit > MAX_HISTORY_LIMIT) limit = MAX_HISTORY_LIMIT;
  const before = query.before ? assertObjectId(query.before, 'INVALID_CURSOR', 'before must be a message id') : null;
  const after = query.after ? assertObjectId(query.after, 'INVALID_CURSOR', 'after must be a message id') : null;
  if (before && after) {
    throw new AppError(400, 'INVALID_CURSOR_RANGE', 'Specify only one of before or after');
  }
  return { limit, before, after };
}

export function canonicalParticipantKey(a, b) {
  const x = String(a); const y = String(b);
  return x < y ? `${x}:${y}` : `${y}:${x}`;
}
