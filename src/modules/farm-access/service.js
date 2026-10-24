import { FarmAccessGrant } from './model.js';
import { AppError } from '../../shared/errors/AppError.js';
import { assertPermissionList, isApprovedPermission } from './permissions.js';
import * as identityService from '../identity/service.js';
import * as farmersService from '../farmers/service.js';

/**
 * Re-export ownership lookup from farmers (source of truth for FarmerProfile).
 * Callers may continue to import from farm-access for compatibility.
 */
export async function findOwnedFarmerProfile(accountId) {
  return farmersService.findOwnedFarmerProfile(accountId);
}

/**
 * Authorize access to a farmer's data.
 * - Owner of the FarmerProfile: allowed without a permission string.
 * - Delegate: must hold the exact catalog permission (when permission is provided).
 * - permission null: owner-only (used for ownership checks).
 */
export async function authorizeFarmAccess(account, farmerProfileId, permission = null) {
  if (!farmerProfileId) {
    throw new AppError(400, 'FARMER_SCOPE_REQUIRED', 'farmerProfileId is required');
  }

  const farmer = await farmersService.getActiveFarmerProfileById(farmerProfileId);
  if (!farmer) {
    throw new AppError(404, 'FARMER_NOT_FOUND', 'Farmer profile not found');
  }

  if (String(farmer.accountId) === String(account._id)) {
    return { mode: 'owner', farmerProfile: farmer, grant: null };
  }

  if (!permission) {
    throw new AppError(403, 'FORBIDDEN', 'Only the farm owner may perform this action');
  }

  if (!isApprovedPermission(permission)) {
    throw new AppError(400, 'INVALID_PERMISSION', `Unknown permission: ${permission}`);
  }

  const now = new Date();
  const grant = await FarmAccessGrant.findOne({
    farmerProfileId: farmer._id,
    recipientAccountId: account._id,
    status: 'active',
  });

  if (!grant) {
    throw new AppError(403, 'FORBIDDEN', 'No active access grant for this farm');
  }
  if (grant.expiresAt && grant.expiresAt <= now) {
    throw new AppError(403, 'FORBIDDEN', 'Access grant has expired');
  }
  if (!grant.permissions.includes(permission)) {
    throw new AppError(403, 'FORBIDDEN', `Missing required permission: ${permission}`);
  }

  return { mode: 'delegate', farmerProfile: farmer, grant };
}

export async function grantAccess(ownerAccount, input) {
  const owned = await findOwnedFarmerProfile(ownerAccount._id);
  if (!owned) {
    throw new AppError(403, 'FARMER_PROFILE_REQUIRED', 'Only a farmer profile owner can grant access');
  }

  const recipientId = input.recipientAccountId;
  if (!recipientId) throw new AppError(400, 'RECIPIENT_REQUIRED', 'recipientAccountId is required');
  if (String(recipientId) === String(ownerAccount._id)) {
    throw new AppError(400, 'SELF_GRANT_FORBIDDEN', 'Cannot grant access to yourself');
  }

  // Identity public interface — no private Account model import.
  const recipient = await identityService.getActiveAccountRef(recipientId);
  if (!recipient) {
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
