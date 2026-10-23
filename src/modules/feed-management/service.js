import { FeedRecord, FEED_RECORD_TYPES } from './model.js';
import { AppError } from '../../shared/errors/AppError.js';
import { resolveFarmScope } from '../../shared/farm/resolveScope.js';
import { assertAnimalInFarm } from '../animals/service.js';

function publicRecord(doc) {
  return {
    id: String(doc._id),
    farmerProfileId: String(doc.farmerProfileId),
    animalId: doc.animalId ? String(doc.animalId) : null,
    recordType: doc.recordType,
    feedName: doc.feedName,
    quantity: doc.quantity,
    unit: doc.unit,
    recordDate: doc.recordDate,
    notes: doc.notes || null,
    recordedByAccountId: doc.recordedByAccountId ? String(doc.recordedByAccountId) : null,
    createsFinanceEntry: false,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function parseDate(value) {
  if (!value) throw new AppError(400, 'RECORD_DATE_REQUIRED', 'recordDate is required');
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new AppError(400, 'INVALID_RECORD_DATE', 'recordDate is invalid');
  return d;
}

function parseQuantity(value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new AppError(400, 'INVALID_QUANTITY', 'quantity must be a non-negative number');
  }
  return n;
}

export async function createRecord(account, input = {}) {
  const { farmerProfile } = await resolveFarmScope(account, input.farmerProfileId, 'feed.record');
  if (input.animalId) {
    await assertAnimalInFarm(input.animalId, farmerProfile._id);
  }

  const recordType = typeof input.recordType === 'string' ? input.recordType.trim().toLowerCase() : '';
  if (!FEED_RECORD_TYPES.includes(recordType)) {
    throw new AppError(400, 'INVALID_RECORD_TYPE', `recordType must be one of: ${FEED_RECORD_TYPES.join(', ')}`);
  }
  const feedName = typeof input.feedName === 'string' ? input.feedName.trim() : '';
  if (!feedName) throw new AppError(400, 'FEED_NAME_REQUIRED', 'feedName is required');

  const row = await FeedRecord.create({
    farmerProfileId: farmerProfile._id,
    animalId: input.animalId || undefined,
    recordType,
    feedName,
    quantity: parseQuantity(input.quantity),
    unit: input.unit ? String(input.unit).trim() : 'kg',
    recordDate: parseDate(input.recordDate),
    notes: input.notes ? String(input.notes).trim() : undefined,
    recordedByAccountId: account._id,
  });
  // Intentionally does NOT create FarmFinancialEntry
  return publicRecord(row);
}

export async function listRecords(account, query = {}) {
  const { farmerProfile } = await resolveFarmScope(account, query.farmerProfileId, 'feed.read');
  const filter = { farmerProfileId: farmerProfile._id };
  if (query.animalId) filter.animalId = query.animalId;
  if (query.recordType && FEED_RECORD_TYPES.includes(query.recordType)) filter.recordType = query.recordType;
  const rows = await FeedRecord.find(filter).sort({ recordDate: -1 }).limit(500);
  return rows.map(publicRecord);
}

export async function updateRecord(account, recordId, input = {}) {
  const row = await FeedRecord.findById(recordId);
  if (!row) throw new AppError(404, 'FEED_RECORD_NOT_FOUND', 'Feed record not found');
  await resolveFarmScope(account, row.farmerProfileId, 'feed.update');

  if (input.feedName !== undefined) {
    const feedName = String(input.feedName).trim();
    if (!feedName) throw new AppError(400, 'FEED_NAME_REQUIRED', 'feedName cannot be empty');
    row.feedName = feedName;
  }
  if (input.quantity !== undefined) row.quantity = parseQuantity(input.quantity);
  if (input.unit !== undefined) row.unit = String(input.unit).trim();
  if (input.recordDate !== undefined) row.recordDate = parseDate(input.recordDate);
  if (input.notes !== undefined) row.notes = String(input.notes).trim();
  if (input.recordType !== undefined) {
    const recordType = String(input.recordType).trim().toLowerCase();
    if (!FEED_RECORD_TYPES.includes(recordType)) {
      throw new AppError(400, 'INVALID_RECORD_TYPE', `recordType must be one of: ${FEED_RECORD_TYPES.join(', ')}`);
    }
    row.recordType = recordType;
  }
  if (input.animalId !== undefined) {
    if (input.animalId) {
      await assertAnimalInFarm(input.animalId, row.farmerProfileId);
      row.animalId = input.animalId;
    } else {
      row.animalId = undefined;
    }
  }
  await row.save();
  return publicRecord(row);
}
