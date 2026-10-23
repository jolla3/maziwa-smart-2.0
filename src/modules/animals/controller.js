import { apiResponse } from '../../shared/http/response.js';
import { AppError } from '../../shared/errors/AppError.js';
import * as service from './service.js';

function handle(res, error) {
  if (error instanceof AppError) {
    return apiResponse.error(res, error.code, error.message, error.status, error.details);
  }
  throw error;
}

export async function list(req, res) {
  try {
    const animals = await service.listAnimals(req.account, req.query || {});
    return apiResponse.success(res, { animals });
  } catch (error) {
    return handle(res, error);
  }
}

export async function getOne(req, res) {
  try {
    const animal = await service.getAnimal(req.account, req.params.animalId);
    return apiResponse.success(res, { animal });
  } catch (error) {
    return handle(res, error);
  }
}

export async function create(req, res) {
  try {
    const animal = await service.createAnimal(req.account, req.body || {});
    return apiResponse.success(res, { animal }, 'Animal registered', 201);
  } catch (error) {
    return handle(res, error);
  }
}

export async function update(req, res) {
  try {
    const animal = await service.updateAnimal(req.account, req.params.animalId, req.body || {});
    return apiResponse.success(res, { animal }, 'Animal updated');
  } catch (error) {
    return handle(res, error);
  }
}
