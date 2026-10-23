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
