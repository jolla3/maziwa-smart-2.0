import { LivestockAd, AdViewEvent, AD_STATUSES, SPECIES } from './model.js';
import { toPublicAdDto, toOwnerAdDto } from './publicDto.js';
import { publicAdCacheKey, publicAdLockKey, publicAdGenKey } from './cacheKeys.js';
import { getOrLoadPublicProduct, invalidatePublicProduct } from '../../shared/cache/productSingleFlight.js';
import { AppError } from '../../shared/errors/AppError.js';
import { SellerProfile } from '../sellers/model.js';
import { authorizeFarmAccess } from '../farm-access/service.js';
import { assertAnimalInFarm } from '../animals/service.js';
import { destroyCloudinaryAsset } from '../../integrations/media-storage/cloudinary.js';

function parsePrice(value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new AppError(400, 'INVALID_PRICE', 'price must be a non-negative number');
  }
  return n;
}

async function requireVerifiedSeller(accountId) {
  const seller = await SellerProfile.findOne({ accountId });
  if (!seller) {
    throw new AppError(403, 'SELLER_PROFILE_REQUIRED', 'Create a seller profile before managing listings');
  }
  return seller;
}

async function assertCanManageAd(account, ad) {
  if (String(ad.advertiserAccountId) === String(account._id)) return { mode: 'owner' };
  if (ad.farmerProfileId) {
    await authorizeFarmAccess(account, ad.farmerProfileId, 'marketplace.manage_farmer_ads');
    return { mode: 'delegate' };
  }
  throw new AppError(403, 'FORBIDDEN', 'You cannot manage this advertisement');
}

async function invalidateAd(adId) {
  await invalidatePublicProduct({
    cacheKey: publicAdCacheKey(adId),
    genKey: publicAdGenKey(adId),
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
  const ad = await LivestockAd.findById(adId);
  if (!ad || ad.status !== 'published') {
    throw new AppError(404, 'AD_NOT_FOUND', 'Advertisement not found');
  }
  ad.viewCount = (ad.viewCount || 0) + 1;
  await ad.save();
  await AdViewEvent.create({
    livestockAdId: ad._id,
    viewerAccountId: viewerAccountId || undefined,
  });
  await invalidateAd(ad._id);
  return { viewCount: ad.viewCount };
}

export async function listMyAds(account, query = {}) {
  const filter = { advertiserAccountId: account._id };
  if (query.status && AD_STATUSES.includes(query.status)) filter.status = query.status;
  const rows = await LivestockAd.find(filter).sort({ updatedAt: -1 }).limit(200);
  return rows.map(toOwnerAdDto);
}

export async function createAd(account, input = {}, imageMeta = []) {
  // Seller profile required for any listing; verification required only to publish.
  let seller = await SellerProfile.findOne({ accountId: account._id });
  if (!seller) {
    seller = await SellerProfile.create({
      accountId: account._id,
      verificationStatus: 'pending',
      submittedAt: new Date(),
    });
  }

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) throw new AppError(400, 'TITLE_REQUIRED', 'title is required');

  const species = typeof input.species === 'string' ? input.species.trim().toLowerCase() : '';
  if (!SPECIES.includes(species)) {
    throw new AppError(400, 'INVALID_SPECIES', `species must be one of: ${SPECIES.join(', ')}`);
  }

  let farmerProfileId = input.farmerProfileId || undefined;
  let animalId = input.animalId || undefined;

  if (animalId) {
    if (!farmerProfileId) {
      throw new AppError(400, 'FARMER_SCOPE_REQUIRED', 'farmerProfileId is required when animalId is set');
    }
    // Owner of farm or marketplace.manage_farmer_ads
    try {
      await authorizeFarmAccess(account, farmerProfileId, null);
    } catch {
      await authorizeFarmAccess(account, farmerProfileId, 'marketplace.manage_farmer_ads');
    }
    await assertAnimalInFarm(animalId, farmerProfileId);
  }

  const status = input.publish === true || input.status === 'published' ? 'published' : 'draft';
  if (status === 'published') {
    const seller = await requireVerifiedSeller(account._id);
    if (seller.verificationStatus !== 'verified') {
      throw new AppError(403, 'SELLER_NOT_VERIFIED', 'Seller must be verified before publishing listings');
    }
    if (!imageMeta.length && !(input.images && input.images.length)) {
      throw new AppError(400, 'IMAGES_REQUIRED', 'At least one image is required to publish');
    }
  }

  const images = imageMeta.length ? imageMeta : (Array.isArray(input.images) ? input.images : []);

  const ad = await LivestockAd.create({
    advertiserAccountId: account._id,
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

  if (imageMeta.length) {
    // Append new uploads; optional replaceAll
    if (input.replaceImages === true || input.replaceImages === 'true') {
      for (const img of ad.images || []) {
        if (img.publicId) await destroyCloudinaryAsset(img.publicId).catch(() => {});
      }
      ad.images = imageMeta;
    } else {
      ad.images = [...(ad.images || []), ...imageMeta];
    }
  }

  if (input.status === 'published' || input.publish === true) {
    const seller = await requireVerifiedSeller(account._id);
    if (seller.verificationStatus !== 'verified') {
      throw new AppError(403, 'SELLER_NOT_VERIFIED', 'Seller must be verified before publishing listings');
    }
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
