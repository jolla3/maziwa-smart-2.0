// src/shared/middleware/csrf.js
//
// Cookie session + CSRF for browser clients.
//
// Protection model:
//   1. Cross-origin browser requests send Origin; it must be allowlisted.
//   2. Unsafe methods require double-submit: csrf-token cookie AND matching
//      X-CSRF-Token header. An allowlisted Origin alone is not sufficient.
//   3. Login/signup remain exempt (no session yet to forge).
//   4. Webhooks never hit this middleware (mounted separately).
//   5. GET/HEAD/OPTIONS remain safe and issue the CSRF cookie for later use.

import crypto from 'crypto';
import { isProduction, isCrossSiteFrontend } from '../../config/environment.js';
import { isAllowedOrigin } from '../../config/security.js';
import { apiResponse } from '../http/response.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_EXEMPT_PATHS = new Set([
  '/auth/signup', '/auth/login',
  '/register', '/register/seller', '/register/farmer', '/login',
]);

function ensureCsrfToken(req, res) {
  let token = req.cookies?.['csrf-token'];
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    const crossSite = isCrossSiteFrontend();
    res.cookie('csrf-token', token, {
      httpOnly: false,
      secure: crossSite || isProduction,
      sameSite: crossSite || isProduction ? 'none' : 'lax',
      path: '/',
    });
  }
  res.setHeader('X-CSRF-Token', token);
  return token;
}

export function issueCsrfCookie(req, res, next) {
  const p = req.path || '';
  if (p === '/health' || p === '/ready' || p.endsWith('/health') || p.endsWith('/ready')) {
    return next();
  }
  ensureCsrfToken(req, res);
  next();
}

export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (CSRF_EXEMPT_PATHS.has(req.path)) return next();

  const cookieToken = req.cookies?.['csrf-token'];
  const headerToken = req.headers['x-csrf-token'];
  const origin = req.headers.origin;

  // Disallowed Origin is always rejected for unsafe methods when Origin is present.
  if (origin && !isAllowedOrigin(origin)) {
    return apiResponse.error(res, 'FORBIDDEN', 'Origin not allowed', 403);
  }

  // Double-submit required for all non-exempt unsafe methods.
  // Allowlisted Origin is necessary for cross-origin browsers but never sufficient alone.
  if (!cookieToken || !headerToken) {
    // issueCsrfCookie runs before route-level CSRF protection and has already
    // primed a missing cookie. Do not issue a second token here.
    return apiResponse.error(res, 'FORBIDDEN', 'CSRF token missing or invalid', 403);
  }

  if (cookieToken !== headerToken) {
    return apiResponse.error(res, 'FORBIDDEN', 'CSRF token missing or invalid', 403);
  }

  return next();
}
