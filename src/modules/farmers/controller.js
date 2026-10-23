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
    const profile = await service.getMyFarmerProfile(req.account);
    return apiResponse.success(res, { profile });
  } catch (error) {
    return handle(res, error);
  }
}

export async function getOne(req, res) {
  try {
    const profile = await service.getFarmerProfile(req.account, req.params.farmerProfileId);
    return apiResponse.success(res, { profile });
  } catch (error) {
    return handle(res, error);
  }
}
