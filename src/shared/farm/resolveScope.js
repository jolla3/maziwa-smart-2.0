import { AppError } from '../errors/AppError.js';
import {
  authorizeFarmAccess,
  findOwnedFarmerProfile,
} from '../../modules/farm-access/service.js';

/**
 * Resolve farmer scope for the acting account.
 * Owners of the FarmerProfile do not need a permission string.
 * Delegates must hold the exact catalog permission.
 */
export async function resolveFarmScope(account, farmerProfileId, permission) {
  let scopeId = farmerProfileId;
  if (!scopeId) {
    const owned = await findOwnedFarmerProfile(account._id);
    if (!owned) {
      throw new AppError(
        400,
        'FARMER_SCOPE_REQUIRED',
        'farmerProfileId is required when the account does not own a farmer profile',
      );
    }
    scopeId = owned._id;
  }
  try {
    return await authorizeFarmAccess(account, scopeId, null);
  } catch (error) {
    if (error instanceof AppError && error.status === 403 && permission) {
      return authorizeFarmAccess(account, scopeId, permission);
    }
    throw error;
  }
}
