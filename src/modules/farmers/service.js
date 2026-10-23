import { FarmerProfile } from './model.js';
import { AppError } from '../../shared/errors/AppError.js';
import { authorizeFarmAccess, findOwnedFarmerProfile } from '../farm-access/service.js';

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
