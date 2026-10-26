import { disconnectAccountSockets } from '../../realtime/socket.js';
import crypto from 'node:crypto';
import { Account } from './model.js';
import { env, isProduction, isCrossSiteFrontend } from '../../config/environment.js';
import { apiResponse } from '../../shared/http/response.js';
import { logger } from '../../config/logger.js';
import {
  authenticatePassword,
  completePasswordSetup,
  getProfile as loadProfile,
  needsPasswordSetup,
  publicAccount,
  registerBuyer as createBuyer,
  registerFarmer as createFarmer,
  registerSeller as createSeller,
  requestPasswordReset,
  resetPassword as performPasswordReset,
  updateProfile as saveProfile,
} from './service.js';
import { IdentityError } from './validation.js';

function saveSession(req) {
  return new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
}

function destroySession(req) {
  return new Promise((resolve) => {
    if (!req.session) return resolve();
    req.session.destroy((error) => {
      // Logout must clear the client cookie even if store deletion races or fails transiently.
      if (error) logger.warn({ error: error.message }, 'Session destroy reported an error');
      resolve();
    });
  });
}

function primaryFrontendUrl() {
  return String(env.FRONTEND_URL || 'http://localhost:5173').split(',').map((part) => part.trim()).filter(Boolean)[0]
    || 'http://localhost:5173';
}

function frontendLoginUrl() {
  const url = new URL('/login', primaryFrontendUrl());
  url.searchParams.set('error', 'Google auth failed');
  return url.toString();
}

function cookieOptions() {
  const crossSite = isCrossSiteFrontend();
  return {
    path: '/',
    httpOnly: true,
    secure: crossSite || isProduction,
    sameSite: crossSite || isProduction ? 'none' : 'lax',
  };
}

function handleError(res, error) {
  if (error instanceof IdentityError) {
    return apiResponse.error(res, error.code, error.message, error.status);
  }
  throw error;
}

export async function registerBuyer(req, res) {
  try {
    const user = await createBuyer(req.body || {});
    return res.status(201).json({ success: true, message: `Welcome ${user.username}! Your account has been created.`, user });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function registerSeller(req, res) {
  try {
    const seller = await createSeller(req.body || {});
    return res.status(201).json({
      success: true,
      message: 'Seller registered. Awaiting verification.',
      seller,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function registerFarmer(req, res) {
  try {
    const farmer = await createFarmer(req.body || {});
    return res.status(201).json({
      success: true,
      message: `Welcome ${farmer.fullname}! Your farmer account has been created.`,
      farmer,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function login(req, res) {
  try {
    const account = await authenticatePassword(req.body?.email, req.body?.password);
    await regenerateSession(req);
    req.session.userId = String(account._id);
    req.session.sessionVersion = Number(account.sessionVersion || 0);
    await saveSession(req);
    return res.json({ success: true, user: publicAccount(account) });
  } catch (error) {
    if (error instanceof IdentityError) return handleError(res, error);
    throw error;
  }
}

export async function logout(req, res) {
  try {
    const accountId = req.session?.userId || req.account?._id;
    await destroySession(req);
    res.clearCookie('connect.sid', cookieOptions());
    if (accountId) {
      try { disconnectAccountSockets(accountId); } catch { /* best-effort */ }
    }
    return res.json({ success: true, message: 'Logged out successfully.' });
  } catch (error) {
    throw error;
  }
}

export async function setPassword(req, res) {
  const pendingAccountId = req.session?.pendingAccountId;
  if (!pendingAccountId) {
    return apiResponse.error(res, 'PASSWORD_SETUP_SESSION_REQUIRED', 'Start or resume Google registration before setting a password.', 401);
  }
  try {
    const account = await completePasswordSetup(pendingAccountId, req.body || {});
    await regenerateSession(req);
    req.session.userId = String(account._id);
    req.session.sessionVersion = Number(account.sessionVersion || 0);
    await saveSession(req);
    const body = { success: true, message: 'Registration complete' };
    if (account.role === 'farmer') {
      const farmer = await loadProfile(account);
      body.farmer_code = farmer.farmer_code;
      body.needs_code_setup = false;
    }
    return res.json(body);
  } catch (error) {
    if (error instanceof IdentityError) return handleError(res, error);
    throw error;
  }
}

export async function forgotPassword(req, res) {
  try {
    await requestPasswordReset(req.body?.email);
    // Do not reveal whether the address belongs to an account or whether email was deliverable.
    return res.status(200).json({ message: 'If account exists, reset link sent' });
  } catch (error) {
    if (error instanceof IdentityError) return handleError(res, error);
    throw error;
  }
}

export async function resetPassword(req, res) {
  try {
    await performPasswordReset(req.body?.token, req.body?.newPassword);
    return res.status(200).json({ message: 'Password reset successful. Please log in.' });
  } catch (error) {
    if (error instanceof IdentityError) return handleError(res, error);
    throw error;
  }
}

export async function sessionStatus(req, res) {
  if (req.session?.pendingAccountId) {
    const pending = await Account.findById(req.session.pendingAccountId);
    if (pending && pending.isActive) {
      return res.json({ authenticated: false, pendingPasswordSetup: true, role: pending.role });
    }
  }
  if (req.session?.userId) {
    const account = await Account.findById(req.session.userId);
    if (account && account.isActive && Number(req.session.sessionVersion ?? 0) === Number(account.sessionVersion ?? 0)) {
      return res.json({ authenticated: true, pendingPasswordSetup: false, user: await loadProfile(account) });
    }
  }
  return res.json({ authenticated: false, pendingPasswordSetup: false, user: null });
}

export async function getProfile(req, res) {
  try {
    return res.json({ success: true, profile: await loadProfile(req.account) });
  } catch (error) {
    if (error instanceof IdentityError) return handleError(res, error);
    throw error;
  }
}

export async function updateProfile(req, res) {
  try {
    const profile = await saveProfile(req.account, req.body || {});
    return res.json({ success: true, message: 'Profile updated', profile });
  } catch (error) {
    if (error instanceof IdentityError) return handleError(res, error);
    throw error;
  }
}

export async function completeGoogleCallback(req, res, account) {
  try {
    const needsSetup = await needsPasswordSetup(account);
    await regenerateSession(req);
    if (needsSetup) {
      req.session.pendingAccountId = String(account._id);
      await saveSession(req);
      return res.redirect(new URL('/set-password', primaryFrontendUrl()).toString());
    }
    req.session.userId = String(account._id);
    req.session.sessionVersion = Number(account.sessionVersion || 0);
    await saveSession(req);
    return res.redirect(new URL('/google-callback', primaryFrontendUrl()).toString());
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to complete Google sign-in');
    return res.redirect(frontendLoginUrl());
  }
}

export function googleFailureRedirect(res) {
  return res.redirect(frontendLoginUrl());
}

export function makeOAuthState() {
  return crypto.randomBytes(32).toString('hex');
}

