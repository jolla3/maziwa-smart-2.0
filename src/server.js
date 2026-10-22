import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { ensureRedisReady, disconnectRedis } from './config/redis.js';
import { logger } from './config/logger.js';
import { env } from './config/environment.js';

async function start() {
  await connectDatabase();
  await ensureRedisReady({ timeoutMs: 8000 });
  const app = createApp();
  const server = app.listen(env.PORT, () => logger.info(`MaziwaSmart 2.0 backend listening on :${env.PORT}`));

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}; shutting down`);
    const forceExit = setTimeout(() => process.exit(1), 10000);
    forceExit.unref();
    server.close(async () => {
      try {
        await disconnectDatabase();
        await disconnectRedis();
        clearTimeout(forceExit);
        process.exit(0);
      } catch (err) {
        logger.error({ error: err.message }, 'Error during shutdown');
        process.exit(1);
      }
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  logger.error({ error: err.message }, 'Fatal startup error');
  process.exit(1);
});
