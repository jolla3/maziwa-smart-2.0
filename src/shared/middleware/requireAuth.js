import { Account } from '../../modules/identity/model.js';
import { apiResponse } from '../http/response.js';

export async function requireAuth(req, res, next) {
  const accountId = req.session?.userId;
  if (!accountId) {
    return apiResponse.error(res, 'AUTH_REQUIRED', 'Authentication required', 401);
  }

  try {
    const account = await Account.findById(accountId);
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
