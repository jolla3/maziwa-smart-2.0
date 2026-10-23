import { apiResponse } from '../../shared/http/response.js';
import { AppError } from '../../shared/errors/AppError.js';
import * as service from './service.js';
import { PERMISSION_CATALOG } from './permissions.js';

function handle(res, error) {
  if (error instanceof AppError) {
    return apiResponse.error(res, error.code, error.message, error.status, error.details);
  }
  throw error;
}

export async function catalog(_req, res) {
  return apiResponse.success(res, { permissions: PERMISSION_CATALOG });
}

export async function grant(req, res) {
  try {
    const grantDoc = await service.grantAccess(req.account, req.body || {});
    return apiResponse.success(res, { grant: grantDoc }, 'Access granted', 201);
  } catch (error) {
    return handle(res, error);
  }
}

export async function revoke(req, res) {
  try {
    const grantDoc = await service.revokeAccess(req.account, req.params.grantId);
    return apiResponse.success(res, { grant: grantDoc }, 'Access revoked');
  } catch (error) {
    return handle(res, error);
  }
}

export async function listMine(req, res) {
  try {
    const asOwner = await service.listGrantsForOwner(req.account).catch((error) => {
      if (error instanceof AppError && error.code === 'FARMER_PROFILE_REQUIRED') return null;
      throw error;
    });
    const asRecipient = await service.listGrantsForRecipient(req.account);
    return apiResponse.success(res, {
      asOwner: asOwner || [],
      asRecipient,
    });
  } catch (error) {
    return handle(res, error);
  }
}
