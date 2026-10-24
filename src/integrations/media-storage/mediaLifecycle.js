/**
 * Cloudinary asset lifecycle helpers for marketplace uploads.
 * Uploads happen in middleware before service validation; failed requests
 * must destroy only the *new* pending assets, never ones already on saved ads.
 */
import { destroyCloudinaryAsset } from './cloudinary.js';
import { logger } from '../../config/logger.js';

/** Extract publicIds from multer files or image meta objects. */
export function collectPublicIds(filesOrMeta = []) {
  const ids = [];
  for (const item of filesOrMeta || []) {
    const id = item.publicId || item.public_id || item.filename;
    if (id && typeof id === 'string') ids.push(id);
  }
  return [...new Set(ids)];
}

/**
 * Best-effort destroy. Returns { destroyed, failed }.
 * Does not throw on individual failures (caller decides retry).
 */
export async function destroyAssets(publicIds = [], { retries = 1 } = {}) {
  const destroyed = [];
  const failed = [];
  for (const publicId of publicIds) {
    let ok = false;
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const result = await destroyCloudinaryAsset(publicId);
        if (result?.result === 'skipped' || result?.result === 'ok' || result?.result === 'not found' || !result?.error) {
          ok = true;
          break;
        }
        lastError = result;
      } catch (error) {
        lastError = error;
      }
    }
    if (ok) destroyed.push(publicId);
    else {
      failed.push({ publicId, error: lastError?.message || String(lastError) });
      logger.warn({ publicId, error: lastError?.message }, 'Cloudinary asset destroy failed');
    }
  }
  return { destroyed, failed };
}

/**
 * Destroy pending upload assets after a failed create/update path.
 * Never pass publicIds that remain referenced on a committed LivestockAd.
 */
export async function compensateFailedUpload(pendingPublicIds) {
  if (!pendingPublicIds?.length) return { destroyed: [], failed: [] };
  return destroyAssets(pendingPublicIds, { retries: 2 });
}
