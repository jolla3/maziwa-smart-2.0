import { FeedRecord, FEED_RECORD_TYPES } from './model.js';
import { AppError } from '../../shared/errors/AppError.js';
import { resolveFarmScope } from '../../shared/farm/resolveScope.js';
import { assertAnimalInFarm } from '../animals/service.js';
import { parseBusinessDate, formatBusinessDate } from '../../shared/time/businessDate.js';

function publicRecord(doc) {
  return {
    id: String(doc._id),
    farmerProfileId: String(doc.farmerProfileId),
    animalId: doc.animalId ? String(doc.animalId) : null,
    recordType: doc.recordType,
    feedName: doc.feedName,
    quantity: doc.quantity,
    unit: doc.unit,
    recordDate: formatBusinessDate(doc.recordDate),
    notes: doc.notes || null,
    recordedByAccountId: doc.recordedByAccountId ? String(doc.recordedByAccountId) : null,
    // Explicit: feed usage never auto-creates farm-finance expense entries.
    createsFinanceEntry: false,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
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

  const unit = input.unit !== undefined && input.unit !== null
    ? String(input.unit).trim()
    : 'kg';
  if (!unit) throw new AppError(400, 'UNIT_REQUIRED', 'unit cannot be empty');

  const row = await FeedRecord.create({
    farmerProfileId: farmerProfile._id,
    animalId: input.animalId || undefined,
    recordType,
    feedName,
    quantity: parseQuantity(input.quantity),
    unit,
    recordDate: parseBusinessDate(input.recordDate, { field: 'recordDate', required: true }),
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
  if (query.recordType && FEED_RECORD_TYPES.includes(query.recordType)) {
    filter.recordType = query.recordType;
  }
  if (query.from || query.to) {
    filter.recordDate = {};
    if (query.from) filter.recordDate.$gte = parseBusinessDate(query.from, { field: 'from' });
    if (query.to) filter.recordDate.$lte = parseBusinessDate(query.to, { field: 'to' });
  }
  const rows = await FeedRecord.find(filter).sort({ recordDate: -1 }).limit(500);
  return rows.map(publicRecord);
}

export async function getRecord(account, recordId) {
  const row = await FeedRecord.findById(recordId);
  if (!row) throw new AppError(404, 'FEED_RECORD_NOT_FOUND', 'Feed record not found');
  await resolveFarmScope(account, row.farmerProfileId, 'feed.read');
  return publicRecord(row);
}

export async function updateRecord(account, recordId, input = {}) {
  const row = await FeedRecord.findById(recordId);
  if (!row) throw new AppError(404, 'FEED_RECORD_NOT_FOUND', 'Feed record not found');
  await resolveFarmScope(account, row.farmerProfileId, 'feed.update');

  if (input.farmerProfileId !== undefined
      && String(input.farmerProfileId) !== String(row.farmerProfileId)) {
    throw new AppError(
      403,
      'FEED_SCOPE_IMMUTABLE',
      'Cannot change farmerProfileId on an existing feed record',
    );
  }

  if (input.feedName !== undefined) {
    const feedName = String(input.feedName).trim();
    if (!feedName) throw new AppError(400, 'FEED_NAME_REQUIRED', 'feedName cannot be empty');
    row.feedName = feedName;
  }
  if (input.quantity !== undefined) row.quantity = parseQuantity(input.quantity);
  if (input.unit !== undefined) {
    const unit = String(input.unit).trim();
    if (!unit) throw new AppError(400, 'UNIT_REQUIRED', 'unit cannot be empty');
    row.unit = unit;
  }
  if (input.recordDate !== undefined) {
    row.recordDate = parseBusinessDate(input.recordDate, { field: 'recordDate', required: true });
  }
  if (input.notes !== undefined) row.notes = String(input.notes).trim();
  if (input.recordType !== undefined) {
    const recordType = String(input.recordType).trim().toLowerCase();
    if (!FEED_RECORD_TYPES.includes(recordType)) {
      throw new AppError(400, 'INVALID_RECORD_TYPE', `recordType must be one of: ${FEED_RECORD_TYPES.join(', ')}`);
    }
    row.recordType = recordType;
  }
  // Optional animal reassignment stays within the same farm only.
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

export { publicRecord, FEED_RECORD_TYPES };
