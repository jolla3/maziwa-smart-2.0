import { apiResponse } from '../../shared/http/response.js';
import * as favouritesService from './service.js';

function accountIdFrom(req) {
  return req.account?._id || req.account?.id || req.user?.id;
}

export async function list(req, res) {
  const data = await favouritesService.listFavourites(accountIdFrom(req), req.query);
  return apiResponse.success(res, data);
}

export async function save(req, res) {
  const data = await favouritesService.saveFavourite(
    accountIdFrom(req),
    req.params.livestockAdId,
  );
  return apiResponse.success(res, data);
}

export async function remove(req, res) {
  const data = await favouritesService.removeFavourite(
    accountIdFrom(req),
    req.params.livestockAdId,
  );
  return apiResponse.success(res, data);
}
