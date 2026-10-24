import { SellerProfile } from './model.js';
import { AppError } from '../../shared/errors/AppError.js';

function publicSeller(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    accountId: String(doc.accountId),
    verificationStatus: doc.verificationStatus,
    submittedAt: doc.submittedAt,
    verifiedAt: doc.verifiedAt || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function getMySellerProfile(account) {
  const profile = await SellerProfile.findOne({ accountId: account._id });
  if (!profile) throw new AppError(404, 'SELLER_PROFILE_NOT_FOUND', 'No seller profile for this account');
  return publicSeller(profile);
}

export async function ensureSellerProfile(account) {
  let profile = await SellerProfile.findOne({ accountId: account._id });
  if (profile) return publicSeller(profile);
  profile = await SellerProfile.create({
    accountId: account._id,
    verificationStatus: 'pending',
    submittedAt: new Date(),
  });
  return publicSeller(profile);
}

/**
 * Operator verification is unresolved in architecture — this endpoint is restricted
 * to accounts with role admin/superadmin until the operator model is approved.
 */
export async function setVerificationStatus(actorAccount, sellerProfileId, status) {
  if (!['admin', 'superadmin'].includes(actorAccount.role)) {
    throw new AppError(403, 'OPERATOR_REQUIRED', 'Only operators can change seller verification status');
  }
  if (!['pending', 'verified', 'rejected'].includes(status)) {
    throw new AppError(400, 'INVALID_STATUS', 'status must be pending, verified, or rejected');
  }
  const profile = await SellerProfile.findById(sellerProfileId);
  if (!profile) throw new AppError(404, 'SELLER_PROFILE_NOT_FOUND', 'Seller profile not found');
  profile.verificationStatus = status;
  profile.verifiedAt = status === 'verified' ? new Date() : undefined;
  await profile.save();
  return publicSeller(profile);
}

/**
 * Public verification gate for marketplace publish.
 * Other modules must use this instead of importing SellerProfile model.
 */
export async function assertVerifiedForPublish(accountId) {
  const seller = await SellerProfile.findOne({ accountId });
  if (!seller) {
    throw new AppError(403, 'SELLER_PROFILE_REQUIRED', 'A seller profile is required to publish listings');
  }
  if (seller.verificationStatus !== 'verified') {
    throw new AppError(403, 'SELLER_NOT_VERIFIED', 'Seller must be verified before publishing listings');
  }
  return publicSeller(seller);
}

/** Whether the account has a verified seller profile (boolean, no throw). */
export async function isVerifiedSeller(accountId) {
  const seller = await SellerProfile.findOne({ accountId });
  return Boolean(seller && seller.verificationStatus === 'verified');
}

/**
 * Create a pending seller profile for a newly registered account.
 * Idempotent: returns existing profile if already present.
 */
export async function createPendingSellerProfile(accountId) {
  if (!accountId) throw new AppError(400, 'ACCOUNT_REQUIRED', 'accountId is required');
  let profile = await SellerProfile.findOne({ accountId });
  if (profile) return publicSeller(profile);
  profile = await SellerProfile.create({
    accountId,
    verificationStatus: 'pending',
    submittedAt: new Date(),
  });
  return publicSeller(profile);
}

export async function getSellerProfileForAccount(accountId) {
  if (!accountId) return null;
  const profile = await SellerProfile.findOne({ accountId });
  return publicSeller(profile);
}
