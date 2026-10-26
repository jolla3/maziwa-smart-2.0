import { apiResponse } from '../../shared/http/response.js';
import { AppError } from '../../shared/errors/AppError.js';
import * as service from './service.js';
import { emitConversationMessage } from '../../realtime/socket.js';

function handle(res, error) {
  if (error instanceof AppError) {
    return apiResponse.error(res, error.code, error.message, error.status, error.details);
  }
  throw error;
}

export async function list(req, res) {
  try {
    const conversations = await service.listConversations(req.account);
    return apiResponse.success(res, { conversations });
  } catch (error) { return handle(res, error); }
}

export async function create(req, res) {
  try {
    const conversation = await service.createOrGetConversation(req.account, req.body || {});
    return apiResponse.success(res, { conversation }, 'Conversation ready', 200);
  } catch (error) { return handle(res, error); }
}

export async function getOne(req, res) {
  try {
    const conversation = await service.getConversation(req.account, req.params.id);
    return apiResponse.success(res, { conversation });
  } catch (error) { return handle(res, error); }
}

export async function listMessages(req, res) {
  try {
    const result = await service.listMessages(req.account, req.params.id, req.query || {});
    return apiResponse.success(res, result);
  } catch (error) { return handle(res, error); }
}

export async function sendMessage(req, res) {
  try {
    const message = await service.sendMessage(req.account, req.params.id, req.body || {});
    // Real-time fan-out only after durable persist (M3).
    try {
      emitConversationMessage(req.params.id, message);
    } catch {
      /* live delivery is best-effort; HTTP response remains authoritative */
    }
    return apiResponse.success(res, { message }, 'Message sent', 201);
  } catch (error) { return handle(res, error); }
}

export async function markRead(req, res) {
  try {
    const conversation = await service.markConversationRead(req.account, req.params.id, req.body || {});
    return apiResponse.success(res, { conversation }, 'Read cursor updated');
  } catch (error) { return handle(res, error); }
}
