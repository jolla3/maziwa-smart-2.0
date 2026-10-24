import { apiResponse } from '../http/response.js';
import * as identityService from '../../modules/identity/service.js';

/**
 * Hydrate req.account from the session via identity public service.
 * Does not import the Account Mongoose model directly.
 */
export async function requireAuth(req, res, next) {
  const accountId = req.session?.userId;
  if (!accountId) {
    return apiResponse.error(res, 'AUTH_REQUIRED', 'Authentication required', 401);
  }

  try {
    const account = await identityService.getAccountForSession(accountId);
    const sessionVersion = Number(req.session?.sessionVersion ?? 0);
    if (!account || !account.isActive || sessionVersion !== Number(account.sessionVersion ?? 0)) {
      return req.session.destroy(() => {
        res.clearCookie('connect.sid', { path: '/' });
        return apiResponse.error(res, 'AUTH_REQUIRED', 'Session is no longer valid', 401);
      });
    }
    req.account = account;
    req.user = {
      id: String(account._id),
      email: account.email,
      role: account.role,
    };
    return next();
  } catch (error) {
    return next(error);
  }
}
