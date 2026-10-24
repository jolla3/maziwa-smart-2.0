import crypto from 'node:crypto';
import { FarmerProfile } from './model.js';
import { AppError } from '../../shared/errors/AppError.js';
import { authorizeFarmAccess } from '../farm-access/service.js';

function publicFarmer(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    accountId: String(doc.accountId),
    fullName: doc.fullName,
    farmerCode: doc.farmerCode ?? null,
    phone: doc.phone || null,
    email: doc.email || null,
    location: doc.location || null,
    photo: doc.photo || null,
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}


/** Public ownership lookup — other modules must not import FarmerProfile model. */
export async function findOwnedFarmerProfile(accountId) {
  if (!accountId) return null;
  return FarmerProfile.findOne({ accountId, isActive: true });
}

export async function getActiveFarmerProfileById(farmerProfileId) {
  if (!farmerProfileId) return null;
  const profile = await FarmerProfile.findById(farmerProfileId);
  if (!profile || !profile.isActive) return null;
  return profile;
}

export async function getMyFarmerProfile(account) {
  const profile = await findOwnedFarmerProfile(account._id);
  if (!profile) throw new AppError(404, 'FARMER_PROFILE_NOT_FOUND', 'No farmer profile for this account');
  return publicFarmer(profile);
}

export async function getFarmerProfile(account, farmerProfileId) {
  // Owner or any active grant can read basic profile metadata (use animals.read as gate for delegates).
  await authorizeFarmAccess(account, farmerProfileId, 'animals.read').catch(async (error) => {
    if (error instanceof AppError && error.status === 403) {
      return authorizeFarmAccess(account, farmerProfileId, null);
    }
    throw error;
  });
  const profile = await FarmerProfile.findById(farmerProfileId);
  if (!profile || !profile.isActive) {
    throw new AppError(404, 'FARMER_PROFILE_NOT_FOUND', 'Farmer profile not found');
  }
  return publicFarmer(profile);
}

export { publicFarmer };

export async function isFarmerPhoneTaken(phone) {
  if (!phone) return false;
  return Boolean(await FarmerProfile.exists({ phone: String(phone).trim() }));
}

export async function isFarmerCodeTaken(code, excludeId = null) {
  if (code === undefined || code === null || code === '') return false;
  const filter = { farmerCode: code };
  if (excludeId) filter._id = { $ne: excludeId };
  return Boolean(await FarmerProfile.exists(filter));
}

export async function allocateFarmerCode() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = crypto.randomInt(10_000_000, 100_000_000);
    if (!(await FarmerProfile.exists({ farmerCode: candidate }))) return candidate;
  }
  const err = new Error('Could not generate a farmer code. Please try again.');
  err.status = 503;
  err.code = 'FARMER_CODE_UNAVAILABLE';
  throw err;
}

/**
 * Create farmer profile for a new account. Fails if one already exists.
 * Used by identity registration — does not import identity models.
 */
export async function createFarmerProfileForAccount({
  accountId,
  fullName,
  farmerCode,
  phone,
  email,
  location,
  photo,
  isActive = true,
}) {
  if (!accountId) throw new AppError(400, 'ACCOUNT_REQUIRED', 'accountId is required');
  const existing = await FarmerProfile.findOne({ accountId });
  if (existing) {
    throw new AppError(409, 'FARMER_PROFILE_EXISTS', 'Farmer profile already exists for this account');
  }
  const doc = await FarmerProfile.create({
    accountId,
    fullName: fullName ? String(fullName).trim() : undefined,
    farmerCode: farmerCode ?? undefined,
    phone: phone ? String(phone).trim() : undefined,
    email: email ? String(email).trim() : undefined,
    location: location ? String(location).trim() : undefined,
    photo: photo ? String(photo).trim() : undefined,
    isActive: isActive !== false,
  });
  return publicFarmer(doc);
}

/** Internal-safe profile snapshot for identity responses (no mongoose doc leakage required). */
export async function getFarmerProfileForAccount(accountId) {
  if (!accountId) return null;
  const doc = await FarmerProfile.findOne({ accountId });
  if (!doc) return null;
  return {
    id: String(doc._id),
    accountId: String(doc.accountId),
    fullName: doc.fullName,
    farmerCode: doc.farmerCode ?? null,
    phone: doc.phone || null,
    email: doc.email || null,
    location: doc.location || null,
    photo: doc.photo || null,
    isActive: doc.isActive !== false,
    createdAt: doc.createdAt,
  };
}

export async function updateFarmerProfileForAccount(accountId, fields = {}) {
  const doc = await FarmerProfile.findOne({ accountId });
  if (!doc) throw new AppError(404, 'FARMER_PROFILE_NOT_FOUND', 'Farmer profile not found');
  if (fields.fullName !== undefined) doc.fullName = String(fields.fullName).trim();
  if (fields.phone !== undefined) doc.phone = String(fields.phone).trim();
  if (fields.location !== undefined) doc.location = String(fields.location).trim();
  if (fields.photo !== undefined) doc.photo = String(fields.photo).trim();
  if (fields.farmerCode !== undefined) {
    const code = fields.farmerCode;
    if (await isFarmerCodeTaken(code, doc._id)) {
      throw new AppError(409, 'FARMER_CODE_EXISTS', `Farmer code ${code} already exists. Choose another one.`);
    }
    doc.farmerCode = code;
  }
  await doc.save();
  return getFarmerProfileForAccount(accountId);
}
