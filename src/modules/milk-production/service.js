import { MilkYieldRecord, TIME_SLOTS } from './model.js';
import { AppError } from '../../shared/errors/AppError.js';
import {
  authorizeFarmAccess,
  findOwnedFarmerProfile,
} from '../farm-access/service.js';
import { assertAnimalInFarm } from '../animals/service.js';

function publicYield(doc) {
  return {
    id: String(doc._id),
    farmerProfileId: String(doc.farmerProfileId),
    animalId: String(doc.animalId),
    yieldDate: doc.yieldDate,
    litres: doc.litres,
    timeSlot: doc.timeSlot,
    notes: doc.notes || null,
    recordedByAccountId: doc.recordedByAccountId ? String(doc.recordedByAccountId) : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function resolveScope(account, farmerProfileId, permission) {
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

function parseLitres(value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new AppError(400, 'INVALID_LITRES', 'litres must be a non-negative number');
  }
  return n;
}

function parseYieldDate(value) {
  if (!value) throw new AppError(400, 'YIELD_DATE_REQUIRED', 'yieldDate is required');
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new AppError(400, 'INVALID_YIELD_DATE', 'yieldDate is invalid');
  return d;
}

export async function recordYield(account, input = {}) {
  const { farmerProfile } = await resolveScope(account, input.farmerProfileId, 'milk.record');
  if (!input.animalId) throw new AppError(400, 'ANIMAL_REQUIRED', 'animalId is required');
  await assertAnimalInFarm(input.animalId, farmerProfile._id);

  const litres = parseLitres(input.litres);
  const yieldDate = parseYieldDate(input.yieldDate);
  const timeSlot = TIME_SLOTS.includes(input.timeSlot) ? input.timeSlot : 'other';

  const row = await MilkYieldRecord.create({
    farmerProfileId: farmerProfile._id,
    animalId: input.animalId,
    yieldDate,
    litres,
    timeSlot,
    notes: input.notes ? String(input.notes).trim() : undefined,
    recordedByAccountId: account._id,
  });

  return publicYield(row);
}

export async function listYields(account, query = {}) {
  const { farmerProfile } = await resolveScope(account, query.farmerProfileId, 'milk.read');
  const filter = { farmerProfileId: farmerProfile._id };
  if (query.animalId) filter.animalId = query.animalId;
  if (query.from || query.to) {
    filter.yieldDate = {};
    if (query.from) filter.yieldDate.$gte = parseYieldDate(query.from);
    if (query.to) filter.yieldDate.$lte = parseYieldDate(query.to);
  }
  const rows = await MilkYieldRecord.find(filter).sort({ yieldDate: -1 }).limit(500);
  return rows.map(publicYield);
}

export async function updateYield(account, yieldId, input = {}) {
  const row = await MilkYieldRecord.findById(yieldId);
  if (!row) throw new AppError(404, 'YIELD_NOT_FOUND', 'Milk yield record not found');
  await resolveScope(account, row.farmerProfileId, 'milk.update');

  if (input.litres !== undefined) row.litres = parseLitres(input.litres);
  if (input.yieldDate !== undefined) row.yieldDate = parseYieldDate(input.yieldDate);
  if (input.timeSlot !== undefined && TIME_SLOTS.includes(input.timeSlot)) row.timeSlot = input.timeSlot;
  if (input.notes !== undefined) row.notes = String(input.notes).trim();

  await row.save();
  return publicYield(row);
}

export async function summarizeYields(account, query = {}) {
  const { farmerProfile } = await resolveScope(account, query.farmerProfileId, 'milk.read');
  const match = { farmerProfileId: farmerProfile._id };
  if (query.animalId) match.animalId = query.animalId;
  if (query.from || query.to) {
    match.yieldDate = {};
    if (query.from) match.yieldDate.$gte = parseYieldDate(query.from);
    if (query.to) match.yieldDate.$lte = parseYieldDate(query.to);
  }

  const [agg] = await MilkYieldRecord.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalLitres: { $sum: '$litres' },
        recordCount: { $sum: 1 },
      },
    },
  ]);

  return {
    farmerProfileId: String(farmerProfile._id),
    totalLitres: agg?.totalLitres || 0,
    recordCount: agg?.recordCount || 0,
    // Explicit: this is production volume, not income.
    isFinancial: false,
  };
}
