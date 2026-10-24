import { apiResponse } from '../../shared/http/response.js';
import { AppError } from '../../shared/errors/AppError.js';
import { filesToImageMeta } from '../../integrations/media-storage/uploader.js';
import { compensateFailedUpload, collectPublicIds } from '../../integrations/media-storage/mediaLifecycle.js';
import * as service from './service.js';

/**
 * Public marketplace responses must not be stored by shared HTTP caches:
 * listing status can change (close/archive) and Redis invalidation does not
 * clear browser/proxy caches. Use no-store for public projection GETs.
 */
const PUBLIC_HTTP_CACHE = 'private, no-store, no-cache, must-revalidate';

function handle(res, error) {
  if (error instanceof AppError) {
    return apiResponse.error(res, error.code, error.message, error.status, error.details);
  }
  throw error;
}

async function withUploadCompensation(req, work) {
  const pendingIds = collectPublicIds(req.files);
  try {
    return await work();
  } catch (error) {
    if (pendingIds.length) {
      await compensateFailedUpload(pendingIds);
    }
    throw error;
  }
}

export async function listPublic(req, res) {
  try {
    const result = await service.listPublicAds(req.query || {});
    res.set('Cache-Control', PUBLIC_HTTP_CACHE);
    return apiResponse.success(res, result);
  } catch (error) {
    return handle(res, error);
  }
}

export async function getPublic(req, res) {
  try {
    const ad = await service.getPublicAd(req.params.adId);
    res.set('Cache-Control', PUBLIC_HTTP_CACHE);
    return apiResponse.success(res, { ad });
  } catch (error) {
    return handle(res, error);
  }
}

export async function recordView(req, res) {
  try {
    const viewerId = req.session?.userId || null;
    const result = await service.recordPublicView(req.params.adId, viewerId);
    res.set('Cache-Control', 'no-store');
    return apiResponse.success(res, result, 'View recorded');
  } catch (error) {
    return handle(res, error);
  }
}

export async function listMine(req, res) {
  try {
    const ads = await service.listMyAds(req.account, req.query || {});
    return apiResponse.success(res, { ads });
  } catch (error) {
    return handle(res, error);
  }
}

export async function create(req, res) {
  try {
    const ad = await withUploadCompensation(req, async () => {
      const images = filesToImageMeta(req.files);
      return service.createAd(req.account, req.body || {}, images);
    });
    return apiResponse.success(res, { ad }, 'Advertisement created', 201);
  } catch (error) {
    return handle(res, error);
  }
}

export async function update(req, res) {
  try {
    const ad = await withUploadCompensation(req, async () => {
      const images = filesToImageMeta(req.files);
      return service.updateAd(req.account, req.params.adId, req.body || {}, images);
    });
    return apiResponse.success(res, { ad }, 'Advertisement updated');
  } catch (error) {
    return handle(res, error);
  }
}

export async function archive(req, res) {
  try {
    const ad = await service.archiveAd(req.account, req.params.adId);
    return apiResponse.success(res, { ad }, 'Advertisement archived');
  } catch (error) {
    return handle(res, error);
  }
}
