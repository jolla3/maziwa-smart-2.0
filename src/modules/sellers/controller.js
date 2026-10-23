import { apiResponse } from '../../shared/http/response.js';
import { AppError } from '../../shared/errors/AppError.js';
import * as service from './service.js';

function handle(res, error) {
  if (error instanceof AppError) {
    return apiResponse.error(res, error.code, error.message, error.status, error.details);
  }
  throw error;
}

export async function me(req, res) {
  try {
    const profile = await service.getMySellerProfile(req.account);
    return apiResponse.success(res, { profile });
  } catch (error) {
    return handle(res, error);
  }
}

export async function ensure(req, res) {
  try {
    const profile = await service.ensureSellerProfile(req.account);
    return apiResponse.success(res, { profile }, 'Seller profile ready', 201);
  } catch (error) {
    return handle(res, error);
  }
}

export async function setStatus(req, res) {
  try {
    const profile = await service.setVerificationStatus(
      req.account,
      req.params.sellerProfileId,
      req.body?.status,
    );
    return apiResponse.success(res, { profile }, 'Verification status updated');
  } catch (error) {
    return handle(res, error);
  }
}
