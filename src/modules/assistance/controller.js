import { apiResponse } from '../../shared/http/response.js';
import * as identityService from '../identity/service.js';
import {
  handleAssistanceRequest,
  matchIntents,
  resolveHit,
  normalizeForMatch,
  validateAssistanceBody,
  processMessage,
} from './service.js';
import { KINDS } from './catalog.js';

/**
 * Optional session resolution for private_info intents only.
 * Never trusts body identity fields.
 * @returns {Promise<null | { verified: true }>}
 * @throws on unexpected identity infrastructure failure
 */
export async function resolveOptionalSessionAccount(req) {
  const accountId = req.session?.userId;
  if (!accountId) return null;

  const account = await identityService.getAccountForSession(accountId);
  const sessionVersion = Number(req.session?.sessionVersion ?? 0);
  if (!account || !account.isActive || sessionVersion !== Number(account.sessionVersion ?? 0)) {
    return null;
  }
  return { verified: true };
}

/**
 * POST /api/v1/assistance/message
 */
export async function postMessage(req, res, next) {
  try {
    const validated = validateAssistanceBody(req.body);
    if (!validated.ok) {
      return apiResponse.error(res, validated.code, validated.message, 400, {
        fields: validated.fields,
      });
    }

    const normalized = normalizeForMatch(validated.message);
    const hits = matchIntents(normalized);
    const resolution = resolveHit(hits);

    let sessionAccount = null;
    const needsSession =
      resolution.type === 'intent' && resolution.intent?.kind === KINDS.PRIVATE_INFO;

    if (needsSession) {
      try {
        sessionAccount = await resolveOptionalSessionAccount(req);
      } catch {
        return apiResponse.error(
          res,
          'ASSISTANCE_INTERNAL_ERROR',
          'Something went wrong while processing your request',
          500,
        );
      }
    }

    const data = processMessage(validated.message, { sessionAccount });
    return apiResponse.success(res, data, 'OK');
  } catch (err) {
    return next(err);
  }
}

// handleAssistanceRequest kept available for pure tests; controller uses explicit path above
void handleAssistanceRequest;
