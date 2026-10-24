import { apiResponse } from '../../shared/http/response.js';
import { AppError } from '../../shared/errors/AppError.js';
import * as service from './service.js';

function handle(res, error) {
  if (error instanceof AppError) {
    return apiResponse.error(res, error.code, error.message, error.status, error.details);
  }
  throw error;
}

export async function dashboard(req, res) {
  try {
    const data = await service.getDashboard(req.account, req.query || {});
    return apiResponse.success(res, { dashboard: data });
  } catch (error) {
    return handle(res, error);
  }
}

export async function milkTrends(req, res) {
  try {
    const data = await service.getMilkTrends(req.account, req.query || {});
    return apiResponse.success(res, { milk: data });
  } catch (error) {
    return handle(res, error);
  }
}

export async function financeSummary(req, res) {
  try {
    const data = await service.getFinanceSummary(req.account, req.query || {});
    return apiResponse.success(res, { finance: data });
  } catch (error) {
    return handle(res, error);
  }
}

export async function herdSummary(req, res) {
  try {
    const data = await service.getHerdSummary(req.account, req.query || {});
    return apiResponse.success(res, { herd: data });
  } catch (error) {
    return handle(res, error);
  }
}
