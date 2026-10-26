import mongoose from 'mongoose';
import { AppError } from '../../shared/errors/AppError.js';
import { Favourite } from './model.js';
import {
  getPublicAdDtoIfPublished,
  mapPublishedPublicAdsByIds,
} from '../livestock-marketplace/service.js';

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

function parsePageLimit(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(query.limit, 10) || DEFAULT_LIMIT));
  return { page, limit };
}

function assertValidAdId(livestockAdId) {
  if (!mongoose.isValidObjectId(livestockAdId)) {
    throw new AppError(404, 'AD_NOT_FOUND', 'Advertisement not found');
  }
}

/**
 * List the authenticated account's favourites with public-safe ad projection.
 * Unavailable (unpublished/missing) ads return ad: null without leaking details.
 */
export async function listFavourites(accountId, query = {}) {
  if (!accountId) {
    throw new AppError(401, 'AUTH_REQUIRED', 'Authentication required');
  }
  const { page, limit } = parsePageLimit(query);
  const filter = { accountId };
  const total = await Favourite.countDocuments(filter);
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  const rows = await Favourite.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  const adMap = await mapPublishedPublicAdsByIds(rows.map((r) => r.livestockAdId));
  const items = rows.map((row) => {
    const id = String(row.livestockAdId);
    const ad = adMap.get(id) || null;
    return {
      livestockAdId: id,
      savedAt: row.createdAt,
      availability: ad ? 'available' : 'unavailable',
      ad,
    };
  });

  return { items, page, limit, total, totalPages };
}

/**
 * Atomic save of a published public ad for the account.
 * Idempotent under unique index — concurrent/repeated saves yield one relationship.
 */
export async function saveFavourite(accountId, livestockAdId) {
  if (!accountId) {
    throw new AppError(401, 'AUTH_REQUIRED', 'Authentication required');
  }
  assertValidAdId(livestockAdId);

  const publicAd = await getPublicAdDtoIfPublished(livestockAdId);
  if (!publicAd) {
    throw new AppError(404, 'AD_NOT_FOUND', 'Advertisement not found');
  }

  try {
    const doc = await Favourite.findOneAndUpdate(
      { accountId, livestockAdId },
      { $setOnInsert: { accountId, livestockAdId } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return {
      livestockAdId: String(livestockAdId),
      saved: true,
      savedAt: doc.createdAt,
    };
  } catch (err) {
    // Duplicate-key race: another concurrent upsert won; return existing.
    if (err?.code === 11000) {
      const existing = await Favourite.findOne({ accountId, livestockAdId }).lean();
      if (existing) {
        return {
          livestockAdId: String(livestockAdId),
          saved: true,
          savedAt: existing.createdAt,
        };
      }
    }
    throw err;
  }
}

/**
 * Idempotent remove — succeeds whether or not the relationship existed.
 * Does not require the ad to still be public.
 */
export async function removeFavourite(accountId, livestockAdId) {
  if (!accountId) {
    throw new AppError(401, 'AUTH_REQUIRED', 'Authentication required');
  }
  assertValidAdId(livestockAdId);
  await Favourite.deleteOne({ accountId, livestockAdId });
  return {
    livestockAdId: String(livestockAdId),
    saved: false,
  };
}
