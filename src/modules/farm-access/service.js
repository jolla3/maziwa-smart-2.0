import { FarmAccessGrant } from './model.js';
import { FarmerProfile } from '../farmers/model.js';
import { Account } from '../identity/model.js';
import { AppError } from '../../shared/errors/AppError.js';
import { assertPermissionList, isApprovedPermission } from './permissions.js';

function isGrantCurrentlyValid(grant) {
  if (!grant || grant.status !== 'active') return false;
  if (grant.expiresAt && grant.expiresAt.getTime() <= Date.now()) return false;
  return true;
}

/** Owner of FarmerProfile for this account, if any. */
export async function findOwnedFarmerProfile(accountId) {
  return FarmerProfile.findOne({ accountId, isActive: true });
}

/**
 * Authorize farm-scoped operation.
 * Returns { mode: 'owner'|'delegate', farmerProfile, grant? }.
 */
export async function authorizeFarmAccess(account, farmerProfileId, permission) {
  if (!account?._id) throw new AppError(401, 'AUTH_REQUIRED', 'Authentication required');
  if (!farmerProfileId) throw new AppError(400, 'FARMER_SCOPE_REQUIRED', 'farmerProfileId is required');
  if (permission && !isApprovedPermission(permission)) {
    throw new AppError(400, 'INVALID_PERMISSION', `Unknown permission: ${permission}`);
  }

  const farmer = await FarmerProfile.findById(farmerProfileId);
  if (!farmer || !farmer.isActive) {
    throw new AppError(404, 'FARMER_NOT_FOUND', 'Farmer profile not found');
  }

  if (String(farmer.accountId) === String(account._id)) {
    return { mode: 'owner', farmerProfile: farmer, grant: null };
  }

  if (!permission) {
    throw new AppError(403, 'FORBIDDEN', 'Not permitted for this farmer scope');
  }

  const grant = await FarmAccessGrant.findOne({
    farmerProfileId: farmer._id,
    recipientAccountId: account._id,
    status: 'active',
  });

  if (!isGrantCurrentlyValid(grant) || !grant.permissions.includes(permission)) {
    throw new AppError(403, 'FORBIDDEN', 'Missing delegated permission for this farm');
  }

  return { mode: 'delegate', farmerProfile: farmer, grant };
}

export async function hasPermission(account, farmerProfileId, permission) {
  try {
    await authorizeFarmAccess(account, farmerProfileId, permission);
    return true;
  } catch (error) {
    if (error instanceof AppError && (error.status === 403 || error.status === 404)) return false;
    throw error;
  }
}

export async function grantAccess(ownerAccount, input) {
  const owned = await findOwnedFarmerProfile(ownerAccount._id);
  if (!owned) throw new AppError(403, 'FARMER_PROFILE_REQUIRED', 'Only a farmer profile owner can grant access');

  const recipientId = input.recipientAccountId;
  if (!recipientId) throw new AppError(400, 'RECIPIENT_REQUIRED', 'recipientAccountId is required');
  if (String(recipientId) === String(ownerAccount._id)) {
    throw new AppError(400, 'SELF_GRANT_FORBIDDEN', 'Cannot grant access to yourself');
  }

  const recipient = await Account.findById(recipientId);
  if (!recipient || !recipient.isActive) {
    throw new AppError(404, 'RECIPIENT_NOT_FOUND', 'Recipient account not found');
  }

  const checked = assertPermissionList(input.permissions || []);
  if (!checked.ok) throw new AppError(400, 'INVALID_PERMISSIONS', checked.message);

  let expiresAt;
  if (input.expiresAt) {
    expiresAt = new Date(input.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new AppError(400, 'INVALID_EXPIRY', 'expiresAt must be a valid date');
    }
  }

  const existing = await FarmAccessGrant.findOne({
    farmerProfileId: owned._id,
    recipientAccountId: recipient._id,
    status: 'active',
  });

  if (existing) {
    existing.permissions = checked.permissions;
    existing.expiresAt = expiresAt;
    existing.note = input.note ? String(input.note).trim() : existing.note;
    existing.grantedByAccountId = ownerAccount._id;
    await existing.save();
    return existing;
  }

  return FarmAccessGrant.create({
    farmerProfileId: owned._id,
    recipientAccountId: recipient._id,
    permissions: checked.permissions,
    status: 'active',
    expiresAt,
    grantedByAccountId: ownerAccount._id,
    note: input.note ? String(input.note).trim() : undefined,
  });
}

export async function revokeAccess(ownerAccount, grantId) {
  const owned = await findOwnedFarmerProfile(ownerAccount._id);
  if (!owned) throw new AppError(403, 'FARMER_PROFILE_REQUIRED', 'Only a farmer profile owner can revoke access');

  const grant = await FarmAccessGrant.findById(grantId);
  if (!grant || String(grant.farmerProfileId) !== String(owned._id)) {
    throw new AppError(404, 'GRANT_NOT_FOUND', 'Access grant not found');
  }
  if (grant.status === 'revoked') return grant;

  grant.status = 'revoked';
  grant.revokedAt = new Date();
  await grant.save();
  return grant;
}

export async function listGrantsForOwner(ownerAccount) {
  const owned = await findOwnedFarmerProfile(ownerAccount._id);
  if (!owned) throw new AppError(403, 'FARMER_PROFILE_REQUIRED', 'Farmer profile required');
  return FarmAccessGrant.find({ farmerProfileId: owned._id }).sort({ createdAt: -1 });
}

export async function listGrantsForRecipient(account) {
  return FarmAccessGrant.find({
    recipientAccountId: account._id,
    status: 'active',
  }).sort({ createdAt: -1 });
}
