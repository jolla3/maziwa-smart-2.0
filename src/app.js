// Express application assembly. Identity routes are mounted here; additional
// domain modules will be mounted as their implementations are ported..
import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import { env, isProduction, isCrossSiteFrontend } from './config/environment.js';
import { helmetMiddleware, corsMiddleware } from './config/security.js';
import { isDatabaseReady } from './config/database.js';
import { checkRedisHealth } from './config/redis.js';
import { logger } from './config/logger.js';
import { issueCsrfCookie, csrfProtection } from './shared/middleware/csrf.js';
import { requestLogger } from './shared/middleware/requestLogger.js';
import { generalApiRateLimiter } from './shared/middleware/rateLimit.js';
import { apiResponse } from './shared/http/response.js';
import identityRoutes from './modules/identity/routes.js';
import farmersRoutes from './modules/farmers/routes.js';
import animalsRoutes from './modules/animals/routes.js';
import milkRoutes from './modules/milk-production/routes.js';
import farmAccessRoutes from './modules/farm-access/routes.js';
import farmFinanceRoutes from './modules/farm-finance/routes.js';
import animalHealthRoutes from './modules/animal-health/routes.js';
import breedingRoutes from './modules/breeding/routes.js';
import feedRoutes from './modules/feed-management/routes.js';
import { AppError } from './shared/errors/AppError.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
  app.use(helmetMiddleware);
  app.use(corsMiddleware);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(requestLogger);

  const crossSite = isCrossSiteFrontend();
  app.use(session({
    name: 'connect.sid',
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    store: MongoStore.create({ mongoUrl: env.MONGO_URI }),
    cookie: {
      httpOnly: true,
      secure: crossSite || isProduction,
      sameSite: crossSite || isProduction ? 'none' : 'lax',
      path: '/',
      maxAge: 8 * 60 * 60 * 1000,
    },
  }));
  app.use(passport.initialize());

  // Liveness is intentionally before CSRF-cookie issuance and API middleware.
  const healthHandler = (_req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.json({ status: 'ok' });
  };
  app.get('/health', healthHandler);
  app.get('/api/v1/health', healthHandler);

  app.get('/ready', async (_req, res) => {
    const mongoReady = isDatabaseReady();
    const redisResult = await checkRedisHealth(400);
    const redisReady = redisResult.status === 'healthy';
    const ready = mongoReady && redisReady;
    return res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      mongo: mongoReady ? 'ready' : 'not_ready',
      redis: redisReady ? 'ready' : 'not_ready',
      redisLatencyMs: redisResult.latencyMs ?? null,
    });
  });

  app.use(issueCsrfCookie);
  // Auth/session responses must not be cached by browsers or intermediary caches.
  app.use('/api/userAuth', (_req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    next();
  });
  app.use('/api/userAuth', generalApiRateLimiter, csrfProtection, identityRoutes);
  app.use('/api/v1', generalApiRateLimiter);
  app.use('/api/v1', csrfProtection);
  app.use('/api/v1/farmers', farmersRoutes);
  app.use('/api/v1/animals', animalsRoutes);
  app.use('/api/v1/milk-yields', milkRoutes);
  app.use('/api/v1/farm-access', farmAccessRoutes);
  app.use('/api/v1/finance', farmFinanceRoutes);
  app.use('/api/v1/animal-health', animalHealthRoutes);
  app.use('/api/v1/breeding', breedingRoutes);
  app.use('/api/v1/feed', feedRoutes);
  app.use((req, res) => apiResponse.error(res, 'NOT_FOUND', `No route for ${req.method} ${req.path}`, 404));
  app.use((err, req, res, _next) => {
    if (err?.name === 'IdentityError' && Number.isInteger(err.status)) {
      return apiResponse.error(res, err.code || 'IDENTITY_ERROR', err.message, err.status);
    }
    if (err instanceof AppError || (err?.name === 'AppError' && Number.isInteger(err.status))) {
      return apiResponse.error(res, err.code || 'APP_ERROR', err.message, err.status, err.details);
    }
    logger.error({ error: err.message, path: req.path }, 'Unhandled request error');
    if (res.headersSent) return;
    return apiResponse.error(res, 'INTERNAL_ERROR', 'Something went wrong', 500);
  });
  return app;
}
