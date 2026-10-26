import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { ensureRedisReady, disconnectRedis } from './config/redis.js';
import { logger } from './config/logger.js';
import { env } from './config/environment.js';
import {
  attachSocketServer,
  closeSocketServer,
} from './realtime/socket.js';

async function start() {
  await connectDatabase();
  await ensureRedisReady({ timeoutMs: 8000 });
  const app = createApp();

  const {
    startMessageSideEffectRecovery,
    stopMessageSideEffectRecovery,
  } = await import('./modules/conversations/sideEffectRecovery.js');

  try {
    const startResult = await startMessageSideEffectRecovery({
      intervalMs: 30_000,
      batchSize: 50,
      initialDrainBatches: 2,
    });
    if (!startResult.workerInstalled) {
      logger.error('Message side-effect recovery worker was not installed');
    } else if (startResult.initialDrainError) {
      logger.warn(
        { error: startResult.initialDrainError },
        'Recovery worker installed after initial drain failure',
      );
    }
  } catch (err) {
    logger.error({ error: err.message }, 'Message side-effect recovery failed to start');
  }

  const server = app.listen(env.PORT, () => logger.info(`MaziwaSmart 2.0 backend listening on :${env.PORT}`));

  try {
    await attachSocketServer(server, {
      sessionMiddleware: app.locals.sessionMiddleware,
      enableRedisAdapter: true,
    });
    logger.info('Socket.IO attached');
  } catch (err) {
    logger.error({ error: err.message }, 'Socket.IO failed to attach; HTTP messaging remains available');
  }

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}; shutting down`);
    const forceExit = setTimeout(() => process.exit(1), 10000);
    forceExit.unref();
    (async () => {
      try {
        await stopMessageSideEffectRecovery();
        await closeSocketServer();
        await new Promise((resolve) => server.close(resolve));
        await disconnectDatabase();
        await disconnectRedis();
        clearTimeout(forceExit);
        process.exit(0);
      } catch (err) {
        logger.error({ error: err.message }, 'Error during shutdown');
        process.exit(1);
      }
    })();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  logger.error({ error: err.message }, 'Fatal startup error');
  process.exit(1);
});
