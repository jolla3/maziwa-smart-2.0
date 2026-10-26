import { logger } from '../../config/logger.js';
import { reconcilePendingMessageSideEffects } from './service.js';

/**
 * Bounded periodic recovery for pending message side effects.
 *
 * Lifecycle:
 * - startMessageSideEffectRecovery always installs the interval (unless already started),
 *   even when the optional initial drain fails.
 * - stopMessageSideEffectRecovery stops scheduling and awaits any in-flight pass.
 * - Timer is unref'd so it does not alone keep the process alive.
 */

let intervalHandle = null;
let activePass = null;
let stopped = true;
let batchSizeDefault = 50;

export async function runSideEffectRecoveryPass({ limit = 50 } = {}) {
  if (activePass) {
    return { skipped: true, reason: 'already_running' };
  }
  const run = (async () => {
    try {
      return await reconcilePendingMessageSideEffects({ limit });
    } finally {
      // activePass cleared in outer finally after await
    }
  })();
  activePass = run;
  try {
    return await run;
  } finally {
    if (activePass === run) activePass = null;
  }
}

/**
 * @param {{ intervalMs?: number, batchSize?: number, initialDrainBatches?: number }} options
 * @returns {Promise<{ intervalMs: number, batchSize: number, startupScanned: number, startupCompleted: number, workerInstalled: boolean, initialDrainError?: string }>}
 */
export async function startMessageSideEffectRecovery(options = {}) {
  const intervalMs = Math.max(1_000, Number(options.intervalMs) || 30_000);
  const batchSize = Math.min(200, Math.max(1, Number(options.batchSize) || 50));
  const initialDrainBatches = Math.min(5, Math.max(0, Number(options.initialDrainBatches) ?? 2));
  batchSizeDefault = batchSize;

  stopped = false;

  let startupScanned = 0;
  let startupCompleted = 0;
  let initialDrainError;

  // Bounded initial drain — failure must not prevent worker installation.
  try {
    for (let i = 0; i < initialDrainBatches; i += 1) {
      if (stopped) break;
      const result = await runSideEffectRecoveryPass({ limit: batchSize });
      if (result.skipped) break;
      startupScanned += result.scanned || 0;
      startupCompleted += result.completed || 0;
      if ((result.scanned || 0) < batchSize) break;
    }
    if (startupScanned > 0) {
      logger.info({ startupScanned, startupCompleted }, 'Message side-effect startup drain');
    }
  } catch (err) {
    initialDrainError = err?.message || String(err);
    logger.warn({ error: initialDrainError }, 'Message side-effect initial drain failed');
  }

  let workerInstalled = Boolean(intervalHandle);
  if (!intervalHandle && !stopped) {
    try {
      intervalHandle = setInterval(() => {
        if (stopped) return;
        runSideEffectRecoveryPass({ limit: batchSizeDefault }).then((result) => {
          if (result && result.scanned > 0) {
            logger.info(result, 'Message side-effect recovery pass');
          }
        }).catch((err) => {
          logger.warn({ error: err.message }, 'Message side-effect recovery pass failed');
        });
      }, intervalMs);
      if (typeof intervalHandle.unref === 'function') intervalHandle.unref();
      workerInstalled = true;
    } catch (err) {
      logger.error({ error: err.message }, 'Message side-effect recovery worker failed to install');
      workerInstalled = false;
      throw err;
    }
  }

  return {
    intervalMs,
    batchSize,
    startupScanned,
    startupCompleted,
    workerInstalled,
    ...(initialDrainError ? { initialDrainError } : {}),
  };
}

/**
 * Stop scheduling new passes and await any in-flight recovery pass.
 * Safe to call multiple times.
 */
export async function stopMessageSideEffectRecovery() {
  stopped = true;
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (activePass) {
    try {
      await activePass;
    } catch {
      // Drain errors are logged by the pass itself; shutdown still proceeds.
    }
  }
}

/** Test/helpers */
export function isRecoveryStopped() {
  return stopped;
}

export function hasRecoveryWorker() {
  return Boolean(intervalHandle);
}

export function getActiveRecoveryPass() {
  return activePass;
}
