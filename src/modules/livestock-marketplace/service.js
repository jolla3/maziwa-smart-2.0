import mongoose from 'mongoose';
import { LivestockAd, AdViewEvent, AD_STATUSES, SPECIES } from './model.js';
import { toPublicAdDto, toOwnerAdDto } from './publicDto.js';
import { publicAdCacheKey, publicAdLockKey, publicAdGenKey } from './cacheKeys.js';
import { getOrLoadPublicProduct, invalidatePublicProduct } from '../../shared/cache/productSingleFlight.js';
import { AppError } from '../../shared/errors/AppError.js';
import * as sellersService from '../sellers/service.js';
import {
  authorizeFarmAccess,
  findOwnedFarmerProfile,
  listGrantsForRecipient,
} from '../farm-access/service.js';
import { assertAnimalInFarm } from '../animals/service.js';
import { destroyCloudinaryAsset } from '../../integrations/media-storage/cloudinary.js';
import { destroyAssets, collectPublicIds } from '../../integrations/media-storage/mediaLifecycle.js';

function parsePrice(value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new AppError(400, 'INVALID_PRICE', 'price must be a non-negative number');
  }
  return n;
}

/**
 * Publish eligibility is tied to the *acting* seller Account (authenticated actor).
 * OWNERSHIP_AND_PERMISSIONS §6.2:
 * - Only a verified SellerProfile may publish.
 * - Farm delegation does not substitute for the acting seller's verification.
 * - Seller verification does not substitute for farm authorization (checked separately).
 */
export async function assertVerifiedSellerForPublish(actingAccountId) {
  return sellersService.assertVerifiedForPublish(actingAccountId);
}

/**
 * Management authorization (architecture):
 *
 * Farm-scoped (farmerProfileId set):
 *   - FarmerProfile owner may manage.
 *   - Otherwise requires a *currently valid* FarmAccessGrant with exact
 *     permission marketplace.manage_farmer_ads.
 *   - advertiserAccountId / createdByAccountId never bypass farm checks.
 *
 * Independent (no farmerProfileId):
 *   - Only advertiserAccountId may manage.
 */
function isPublishRequested(input = {}) {
  if (input.status === 'published' || input.publish === true) return true;
  return typeof input.publish === 'string'
    && input.publish.trim().toLowerCase() === 'true';
}

export async function assertCanManageAd(account, ad) {
  if (!account?._id) {
    throw new AppError(401, 'AUTH_REQUIRED', 'Authentication required');
  }

  if (ad.farmerProfileId) {
    try {
      const asOwner = await authorizeFarmAccess(account, ad.farmerProfileId, null);
      if (asOwner.mode === 'owner') {
        return { mode: 'farm_owner', farmerProfile: asOwner.farmerProfile, grant: null };
      }
    } catch (error) {
      if (!(error instanceof AppError) || error.status !== 403) throw error;
    }

    const asDelegate = await authorizeFarmAccess(
      account,
      ad.farmerProfileId,
      'marketplace.manage_farmer_ads',
    );
    return { mode: 'delegate', farmerProfile: asDelegate.farmerProfile, grant: asDelegate.grant };
  }

  if (String(ad.advertiserAccountId) === String(account._id)) {
    return { mode: 'advertiser', farmerProfile: null, grant: null };
  }

  throw new AppError(403, 'FORBIDDEN', 'You cannot manage this advertisement');
}

async function invalidateAd(adId) {
  return invalidatePublicProduct({
    cacheKey: publicAdCacheKey(String(adId)),
    genKey: publicAdGenKey(String(adId)),
  });
}

export async function listPublicAds(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  const filter = { status: 'published' };

  if (query.species && SPECIES.includes(String(query.species).toLowerCase())) {
    filter.species = String(query.species).toLowerCase();
  }
  if (query.location) {
    filter.location = new RegExp(String(query.location).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    filter.price = {};
    if (query.minPrice !== undefined) filter.price.$gte = parsePrice(query.minPrice);
    if (query.maxPrice !== undefined) filter.price.$lte = parsePrice(query.maxPrice);
  }
  if (query.q && String(query.q).trim()) {
    filter.$text = { $search: String(query.q).trim() };
  }

  const [total, rows] = await Promise.all([
    LivestockAd.countDocuments(filter),
    LivestockAd.find(filter)
      .sort(query.q ? { score: { $meta: 'textScore' } } : { publishedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
  ]);

  return {
    items: rows.map(toPublicAdDto),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 0,
  };
}


/**
 * Public-safe lookup without throwing — for cross-module consumers (e.g. favourites).
 * Returns DTO only when the ad is currently published; otherwise null.
 */
export async function getPublicAdDtoIfPublished(adId) {
  if (!mongoose.isValidObjectId(adId)) return null;
  const ad = await LivestockAd.findOne({ _id: adId, status: 'published' }).lean();
  return ad ? toPublicAdDto(ad) : null;
}

/**
 * Batch public DTOs for published ads only. Keys are stringified ids.
 */
export async function mapPublishedPublicAdsByIds(adIds = []) {
  const ids = [...new Set((adIds || []).map(String).filter((id) => mongoose.isValidObjectId(id)))];
  const map = new Map();
  if (!ids.length) return map;
  const ads = await LivestockAd.find({ _id: { $in: ids }, status: 'published' }).lean();
  for (const ad of ads) {
    map.set(String(ad._id), toPublicAdDto(ad));
  }
  return map;
}

export async function getPublicAd(adId) {
  return getOrLoadPublicProduct({
    cacheKey: publicAdCacheKey(adId),
    lockKey: publicAdLockKey(adId),
    genKey: publicAdGenKey(adId),
    loader: async () => {
      const ad = await LivestockAd.findById(adId);
      if (!ad || ad.status !== 'published') {
        throw new AppError(404, 'AD_NOT_FOUND', 'Advertisement not found');
      }
      return toPublicAdDto(ad);
    },
  });
}

export async function recordPublicView(adId, viewerAccountId = null) {
  // Atomic increment avoids lost updates under concurrent views.
  const ad = await LivestockAd.findOneAndUpdate(
    { _id: adId, status: 'published' },
    { $inc: { viewCount: 1 } },
    { new: true },
  );
  if (!ad) {
    throw new AppError(404, 'AD_NOT_FOUND', 'Advertisement not found');
  }

  let eventRecorded = true;
  try {
    await AdViewEvent.create({
      livestockAdId: ad._id,
      viewerAccountId: viewerAccountId || undefined,
    });
  } catch (error) {
    eventRecorded = false;
    // Count already committed; still invalidate so cached DTO is not permanently stale.
    const { logger } = await import('../../config/logger.js');
    logger.warn({ error: error.message, adId: String(ad._id) }, 'AdViewEvent create failed after viewCount increment');
  }

  const invalidation = await invalidateAd(ad._id);
  return {
    viewCount: ad.viewCount,
    eventRecorded,
    cacheInvalidated: invalidation?.ok !== false,
  };
}

/**
 * List ads the actor can manage *now*.
 * Candidate query is bounded; each candidate is re-authorized via assertCanManageAd.
 */
export async function listMyAds(account, query = {}) {
  const ownedFarm = await findOwnedFarmerProfile(account._id);
  const grants = await listGrantsForRecipient(account);
  const managedFarmIds = [];
  for (const g of grants) {
    if (g.status !== 'active') continue;
    if (g.expiresAt && g.expiresAt.getTime() <= Date.now()) continue;
    if (!Array.isArray(g.permissions) || !g.permissions.includes('marketplace.manage_farmer_ads')) continue;
    managedFarmIds.push(g.farmerProfileId);
  }

  const orClauses = [
    // Independent ads (no farm scope) owned by this advertiser
    {
      advertiserAccountId: account._id,
      $or: [{ farmerProfileId: null }, { farmerProfileId: { $exists: false } }],
    },
  ];
  if (ownedFarm) {
    orClauses.push({ farmerProfileId: ownedFarm._id });
  }
  if (managedFarmIds.length) {
    orClauses.push({ farmerProfileId: { $in: managedFarmIds } });
  }

  const filter = { $or: orClauses };
  if (query.status && AD_STATUSES.includes(query.status)) filter.status = query.status;

  const rows = await LivestockAd.find(filter).sort({ updatedAt: -1 }).limit(200);

  const visible = [];
  for (const ad of rows) {
    try {
      await assertCanManageAd(account, ad);
      visible.push(toOwnerAdDto(ad));
    } catch (error) {
      if (!(error instanceof AppError) || error.status !== 403) throw error;
    }
  }
  return visible;
}

export async function createAd(account, input = {}, imageMeta = []) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) throw new AppError(400, 'TITLE_REQUIRED', 'title is required');

  const species = typeof input.species === 'string' ? input.species.trim().toLowerCase() : '';
  if (!SPECIES.includes(species)) {
    throw new AppError(400, 'INVALID_SPECIES', `species must be one of: ${SPECIES.join(', ')}`);
  }

  let farmerProfileId = input.farmerProfileId || undefined;
  let animalId = input.animalId || undefined;
  const advertiserAccountId = account._id;
  const createdByAccountId = account._id;

  if (animalId || farmerProfileId) {
    if (animalId && !farmerProfileId) {
      throw new AppError(400, 'FARMER_SCOPE_REQUIRED', 'farmerProfileId is required when animalId is set');
    }
    let access;
    try {
      access = await authorizeFarmAccess(account, farmerProfileId, null);
    } catch (error) {
      if (!(error instanceof AppError) || error.status !== 403) throw error;
      access = await authorizeFarmAccess(account, farmerProfileId, 'marketplace.manage_farmer_ads');
    }
    farmerProfileId = access.farmerProfile._id;
    if (animalId) {
      await assertAnimalInFarm(animalId, farmerProfileId);
    }
  }

  // Ensure seller profile via sellers module public API (no private model import).
  await sellersService.ensureSellerProfile({ _id: advertiserAccountId });

  const status = isPublishRequested(input) ? 'published' : 'draft';
  if (status === 'published') {
    // Acting seller must be verified (§6.2). advertiserAccountId is set to actor on create.
    await assertVerifiedSellerForPublish(account._id);
    if (!imageMeta.length && !(input.images && input.images.length)) {
      throw new AppError(400, 'IMAGES_REQUIRED', 'At least one image is required to publish');
    }
  }

  const images = imageMeta.length ? imageMeta : (Array.isArray(input.images) ? input.images : []);

  const ad = await LivestockAd.create({
    advertiserAccountId,
    createdByAccountId,
    farmerProfileId,
    animalId,
    title,
    description: input.description ? String(input.description).trim() : '',
    species,
    price: parsePrice(input.price),
    currency: String(input.currency || 'KES').toUpperCase(),
    location: input.location ? String(input.location).trim() : '',
    images,
    status,
    attributes: {
      breedLabel: input.breedLabel || input.attributes?.breedLabel,
      gender: input.gender || input.attributes?.gender,
      ageText: input.ageText || input.attributes?.ageText,
      stage: input.stage || input.attributes?.stage,
    },
    publishedAt: status === 'published' ? new Date() : undefined,
  });

  return toOwnerAdDto(ad);
}

export async function updateAd(account, adId, input = {}, imageMeta = []) {
  const ad = await LivestockAd.findById(adId);
  if (!ad || ad.status === 'archived') {
    throw new AppError(404, 'AD_NOT_FOUND', 'Advertisement not found');
  }
  await assertCanManageAd(account, ad);

  let pendingDestroyIds = [];

  // Refuse ownership-transfer style field changes via update.
  if (input.farmerProfileId !== undefined && String(input.farmerProfileId || '') !== String(ad.farmerProfileId || '')) {
    throw new AppError(400, 'FARM_SCOPE_IMMUTABLE', 'Cannot change farmerProfileId on an existing advertisement');
  }
  if (input.animalId !== undefined && String(input.animalId || '') !== String(ad.animalId || '')) {
    throw new AppError(400, 'ANIMAL_IMMUTABLE', 'Cannot change animalId on an existing advertisement');
  }
  if (input.advertiserAccountId !== undefined && String(input.advertiserAccountId) !== String(ad.advertiserAccountId)) {
    throw new AppError(400, 'ADVERTISER_IMMUTABLE', 'Cannot change advertiserAccountId on an existing advertisement');
  }

  if (input.title !== undefined) {
    const title = String(input.title).trim();
    if (!title) throw new AppError(400, 'TITLE_REQUIRED', 'title cannot be empty');
    ad.title = title;
  }
  if (input.description !== undefined) ad.description = String(input.description).trim();
  if (input.species !== undefined) {
    const species = String(input.species).trim().toLowerCase();
    if (!SPECIES.includes(species)) throw new AppError(400, 'INVALID_SPECIES', 'Invalid species');
    ad.species = species;
  }
  if (input.price !== undefined) ad.price = parsePrice(input.price);
  if (input.currency !== undefined) ad.currency = String(input.currency).toUpperCase();
  if (input.location !== undefined) ad.location = String(input.location).trim();
  if (input.breedLabel !== undefined || input.gender !== undefined || input.ageText !== undefined || input.stage !== undefined) {
    ad.attributes = {
      ...(ad.attributes?.toObject?.() || ad.attributes || {}),
      ...(input.breedLabel !== undefined ? { breedLabel: String(input.breedLabel).trim() } : {}),
      ...(input.gender !== undefined ? { gender: input.gender } : {}),
      ...(input.ageText !== undefined ? { ageText: String(input.ageText).trim() } : {}),
      ...(input.stage !== undefined ? { stage: String(input.stage).trim() } : {}),
    };
  }

  // Defer Cloudinary deletes until AFTER successful save.
  if (imageMeta.length) {
    if (input.replaceImages === true || input.replaceImages === 'true') {
      pendingDestroyIds = (ad.images || []).map((img) => img.publicId).filter(Boolean);
      ad.images = imageMeta;
    } else {
      ad.images = [...(ad.images || []), ...imageMeta];
    }
  }

  if (isPublishRequested(input)) {
    // Acting seller (authenticated account) must be verified — not the stored advertiser alone.
    // assertCanManageAd already enforced owner or active marketplace.manage_farmer_ads.
    await assertVerifiedSellerForPublish(account._id);
    if (!ad.images?.length) {
      throw new AppError(400, 'IMAGES_REQUIRED', 'At least one image is required to publish');
    }
    ad.status = 'published';
    ad.publishedAt = ad.publishedAt || new Date();
    ad.closedAt = undefined;
  } else if (input.status === 'closed') {
    ad.status = 'closed';
    ad.closedAt = new Date();
  } else if (input.status === 'draft') {
    ad.status = 'draft';
  } else if (input.status === 'archived') {
    ad.status = 'archived';
  }

  await ad.save();
  // DB commit succeeded — safe to destroy replaced assets (not the newly saved ones).
  if (pendingDestroyIds.length) {
    await destroyAssets(pendingDestroyIds, { retries: 2 });
  }
  await invalidateAd(ad._id);
  return toOwnerAdDto(ad);
}

export async function archiveAd(account, adId) {
  const ad = await LivestockAd.findById(adId);
  if (!ad) throw new AppError(404, 'AD_NOT_FOUND', 'Advertisement not found');
  await assertCanManageAd(account, ad);
  ad.status = 'archived';
  await ad.save();
  await invalidateAd(ad._id);
  return toOwnerAdDto(ad);
}

/**
 * Internal messaging target resolution for the conversations module.
 * Returns only fields needed to open a listing conversation.
 * Recipient is always advertiserAccountId — never createdByAccountId or farmerProfileId.
 * Not a public DTO; do not expose through marketplace public responses.
 */
export async function getMessagingTargetForAd(livestockAdId) {
  if (!livestockAdId || !mongoose.Types.ObjectId.isValid(String(livestockAdId))) {
    throw new AppError(400, 'INVALID_LIVESTOCK_AD_ID', 'livestockAdId is required');
  }
  const ad = await LivestockAd.findById(livestockAdId)
    .select('_id status advertiserAccountId title')
    .lean();
  if (!ad) {
    throw new AppError(404, 'LIVESTOCK_AD_NOT_FOUND', 'Livestock advertisement not found');
  }
  return {
    adId: String(ad._id),
    status: ad.status,
    advertiserAccountId: String(ad.advertiserAccountId),
    title: typeof ad.title === 'string' ? ad.title : '',
  };
}
