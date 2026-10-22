// Express application assembly only. Domain routes are intentionally not
// stubbed here; later slices will mount real modules after their code is ported.
import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import cookieParser from 'cookie-parser';
import { env, isProduction, isCrossSiteFrontend } from './config/environment.js';
import { helmetMiddleware, corsMiddleware } from './config/security.js';
import { isDatabaseReady } from './config/database.js';
import { checkRedisHealth } from './config/redis.js';
import { logger } from './config/logger.js';
import { issueCsrfCookie, csrfProtection } from './shared/middleware/csrf.js';
import { requestLogger } from './shared/middleware/requestLogger.js';
import { generalApiRateLimiter } from './shared/middleware/rateLimit.js';
import { apiResponse } from './shared/http/response.js';

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
  app.use('/api/v1', generalApiRateLimiter);
  app.use('/api/v1', csrfProtection);
  app.use((req, res) => apiResponse.error(res, 'NOT_FOUND', `No route for ${req.method} ${req.path}`, 404));
  app.use((err, req, res, _next) => {
    logger.error({ error: err.message, path: req.path }, 'Unhandled request error');
    if (res.headersSent) return;
    return apiResponse.error(res, 'INTERNAL_ERROR', 'Something went wrong', 500);
  });
  return app;
}
