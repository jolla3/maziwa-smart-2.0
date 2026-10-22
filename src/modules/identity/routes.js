import express from 'express';
import passport, { hasGoogleOAuthConfig } from './googleStrategy.js';
import { env } from '../../config/environment.js';
import { logger } from '../../config/logger.js';
import { authRateLimiter } from '../../shared/middleware/rateLimit.js';
import { apiResponse } from '../../shared/http/response.js';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import * as controller from './controller.js';
import { IdentityError, normalizeGoogleSignupRole, oauthStateMatches } from './validation.js';

const router = express.Router();

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function saveSession(req) {
  return new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
}

function primaryFrontendUrl() {
  return String(env.FRONTEND_URL || 'http://localhost:5173').split(',').map((part) => part.trim()).filter(Boolean)[0]
    || 'http://localhost:5173';
}

router.get('/session', asyncRoute(controller.sessionStatus));
router.post('/register', authRateLimiter, asyncRoute(controller.registerBuyer));
router.post('/register/seller', authRateLimiter, asyncRoute(controller.registerSeller));
router.post('/register/farmer', authRateLimiter, asyncRoute(controller.registerFarmer));
router.post('/login', authRateLimiter, asyncRoute(controller.login));
router.post('/logout', requireAuth, asyncRoute(controller.logout));
router.post('/set-password', authRateLimiter, asyncRoute(controller.setPassword));
router.post('/forgot-password', authRateLimiter, asyncRoute(controller.forgotPassword));
router.post('/reset-password', authRateLimiter, asyncRoute(controller.resetPassword));
router.get('/profile', requireAuth, asyncRoute(controller.getProfile));
router.patch('/update-profile', requireAuth, asyncRoute(controller.updateProfile));
router.get('/me', requireAuth, asyncRoute(controller.getProfile));

router.get('/google', authRateLimiter, asyncRoute(async (req, res, next) => {
  if (!hasGoogleOAuthConfig) {
    return apiResponse.error(res, 'GOOGLE_OAUTH_NOT_CONFIGURED', 'Google sign-in is not configured on this server.', 503);
  }
  const role = normalizeGoogleSignupRole(req.query.role);
  if (!role) {
    throw new IdentityError(400, 'INVALID_GOOGLE_ROLE', 'Google sign-in role must be buyer, seller, or farmer.');
  }
  const state = controller.makeOAuthState();
  req.session.oauthState = { state, role };
  await saveSession(req);
  return passport.authenticate('google', {
    scope: ['profile', 'email'],
    state,
    session: false,
  })(req, res, next);
}));

router.get('/google/callback', authRateLimiter, asyncRoute(async (req, res, next) => {
  if (!hasGoogleOAuthConfig) {
    return controller.googleFailureRedirect(res);
  }
  const stored = req.session?.oauthState;
  const suppliedState = typeof req.query.state === 'string' ? req.query.state : '';
  const expectedState = typeof stored?.state === 'string' ? stored.state : '';
  if (!oauthStateMatches(suppliedState, expectedState) || !stored?.role) {
    return controller.googleFailureRedirect(res);
  }

  req.oauthSelectedRole = stored.role;
  delete req.session.oauthState;
  await saveSession(req);

  return passport.authenticate('google', { session: false }, (error, account) => {
    if (error) {
      logger.warn({ error: error.message }, 'Google sign-in failed');
      return controller.googleFailureRedirect(res);
    }
    if (!account) return controller.googleFailureRedirect(res);
    return controller.completeGoogleCallback(req, res, account);
  })(req, res, next);
}));

export default router;
