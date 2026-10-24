import { apiResponse } from '../../shared/http/response.js';
import { AppError } from '../../shared/errors/AppError.js';
import * as service from './service.js';

function handle(res, error) {
  if (error instanceof AppError) {
    return apiResponse.error(res, error.code, error.message, error.status, error.details);
  }
  throw error;
}

export async function create(req, res) {
  try {
    const record = await service.createRecord(req.account, req.body || {});
    return apiResponse.success(res, { record }, 'Feed record saved', 201);
  } catch (error) {
    return handle(res, error);
  }
}

export async function list(req, res) {
  try {
    const records = await service.listRecords(req.account, req.query || {});
    return apiResponse.success(res, { records });
  } catch (error) {
    return handle(res, error);
  }
}

export async function getOne(req, res) {
  try {
    const record = await service.getRecord(req.account, req.params.recordId);
    return apiResponse.success(res, { record });
  } catch (error) {
    return handle(res, error);
  }
}

export async function update(req, res) {
  try {
    const record = await service.updateRecord(req.account, req.params.recordId, req.body || {});
    return apiResponse.success(res, { record }, 'Feed record updated');
  } catch (error) {
    return handle(res, error);
  }
}
