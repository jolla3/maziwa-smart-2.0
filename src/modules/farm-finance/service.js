import { FarmFinancialEntry, ENTRY_TYPES } from './model.js';
import { AppError } from '../../shared/errors/AppError.js';
import { resolveFarmScope } from '../../shared/farm/resolveScope.js';
import { assertAnimalInFarm } from '../animals/service.js';
import { parseBusinessDate, formatBusinessDate } from '../../shared/time/businessDate.js';

function publicEntry(doc) {
  return {
    id: String(doc._id),
    farmerProfileId: String(doc.farmerProfileId),
    entryType: doc.entryType,
    amount: doc.amount,
    currency: doc.currency,
    category: doc.category,
    description: doc.description || null,
    entryDate: formatBusinessDate(doc.entryDate),
    animalId: doc.animalId ? String(doc.animalId) : null,
    relatedFeedRecordId: doc.relatedFeedRecordId ? String(doc.relatedFeedRecordId) : null,
    recordedByAccountId: doc.recordedByAccountId ? String(doc.recordedByAccountId) : null,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function parseAmount(value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new AppError(400, 'INVALID_AMOUNT', 'amount must be a non-negative number');
  }
  return n;
}

function parseCurrency(value) {
  const c = String(value || 'KES').trim().toUpperCase();
  if (!c || !/^[A-Z]{3}$/.test(c)) {
    throw new AppError(400, 'INVALID_CURRENCY', 'currency must be a 3-letter ISO-style code (e.g. KES)');
  }
  return c;
}

function permissionForCreate(entryType) {
  if (entryType === 'income') return 'finance.record_income';
  if (entryType === 'expense') return 'finance.record_expense';
  throw new AppError(400, 'INVALID_ENTRY_TYPE', 'entryType must be income or expense');
}

export async function createEntry(account, input = {}) {
  const entryType = typeof input.entryType === 'string' ? input.entryType.trim().toLowerCase() : '';
  if (!ENTRY_TYPES.includes(entryType)) {
    throw new AppError(400, 'INVALID_ENTRY_TYPE', 'entryType must be income or expense');
  }
  const category = typeof input.category === 'string' ? input.category.trim() : '';
  if (!category) throw new AppError(400, 'CATEGORY_REQUIRED', 'category is required');

  const { farmerProfile } = await resolveFarmScope(
    account,
    input.farmerProfileId,
    permissionForCreate(entryType),
  );

  if (input.animalId) {
    await assertAnimalInFarm(input.animalId, farmerProfile._id);
  }

  // relatedFeedRecordId is informational only — no private FeedRecord import; no amount derivation.
  const entry = await FarmFinancialEntry.create({
    farmerProfileId: farmerProfile._id,
    entryType,
    amount: parseAmount(input.amount),
    currency: parseCurrency(input.currency),
    category,
    description: input.description ? String(input.description).trim() : undefined,
    entryDate: parseBusinessDate(input.entryDate, { field: 'entryDate', required: true }),
    animalId: input.animalId || undefined,
    relatedFeedRecordId: input.relatedFeedRecordId || undefined,
    recordedByAccountId: account._id,
    status: 'posted',
  });
  return publicEntry(entry);
}

export async function getEntry(account, entryId) {
  const entry = await FarmFinancialEntry.findById(entryId);
  if (!entry) throw new AppError(404, 'ENTRY_NOT_FOUND', 'Financial entry not found');
  await resolveFarmScope(account, entry.farmerProfileId, 'finance.read');
  return publicEntry(entry);
}

export async function updateEntry(account, entryId, input = {}) {
  const entry = await FarmFinancialEntry.findById(entryId);
  if (!entry || entry.status === 'void') {
    throw new AppError(404, 'ENTRY_NOT_FOUND', 'Financial entry not found');
  }
  await resolveFarmScope(account, entry.farmerProfileId, 'finance.update');

  if (input.farmerProfileId !== undefined
      && String(input.farmerProfileId) !== String(entry.farmerProfileId)) {
    throw new AppError(
      403,
      'FINANCE_SCOPE_IMMUTABLE',
      'Cannot change farmerProfileId on an existing financial entry',
    );
  }
  if (input.entryType !== undefined
      && String(input.entryType).trim().toLowerCase() !== entry.entryType) {
    throw new AppError(
      400,
      'ENTRY_TYPE_IMMUTABLE',
      'Cannot reclassify entryType after create; void and record a new entry if needed',
    );
  }

  if (input.amount !== undefined) entry.amount = parseAmount(input.amount);
  if (input.category !== undefined) {
    const category = String(input.category).trim();
    if (!category) throw new AppError(400, 'CATEGORY_REQUIRED', 'category cannot be empty');
    entry.category = category;
  }
  if (input.description !== undefined) entry.description = String(input.description).trim();
  if (input.entryDate !== undefined) {
    entry.entryDate = parseBusinessDate(input.entryDate, { field: 'entryDate', required: true });
  }
  if (input.currency !== undefined) entry.currency = parseCurrency(input.currency);
  if (input.animalId !== undefined) {
    if (input.animalId) {
      await assertAnimalInFarm(input.animalId, entry.farmerProfileId);
      entry.animalId = input.animalId;
    } else {
      entry.animalId = undefined;
    }
  }
  if (input.relatedFeedRecordId !== undefined) {
    entry.relatedFeedRecordId = input.relatedFeedRecordId || undefined;
  }

  await entry.save();
  return publicEntry(entry);
}

/**
 * Soft-void using existing baseline route. Requires finance.update.
 * Does not invent broader deletion/audit workflows.
 */
export async function voidEntry(account, entryId) {
  const entry = await FarmFinancialEntry.findById(entryId);
  if (!entry) throw new AppError(404, 'ENTRY_NOT_FOUND', 'Financial entry not found');
  if (entry.status === 'void') return publicEntry(entry);
  await resolveFarmScope(account, entry.farmerProfileId, 'finance.update');
  entry.status = 'void';
  await entry.save();
  return publicEntry(entry);
}

export async function listEntries(account, query = {}) {
  const { farmerProfile } = await resolveFarmScope(account, query.farmerProfileId, 'finance.read');
  const filter = {
    farmerProfileId: farmerProfile._id,
    status: query.includeVoid === 'true' || query.includeVoid === true
      ? { $in: ['posted', 'void'] }
      : 'posted',
  };
  if (query.entryType && ENTRY_TYPES.includes(query.entryType)) filter.entryType = query.entryType;
  if (query.currency) filter.currency = String(query.currency).toUpperCase();
  if (query.category) filter.category = String(query.category).trim();
  if (query.from || query.to) {
    filter.entryDate = {};
    if (query.from) filter.entryDate.$gte = parseBusinessDate(query.from, { field: 'from' });
    if (query.to) filter.entryDate.$lte = parseBusinessDate(query.to, { field: 'to' });
  }
  const rows = await FarmFinancialEntry.find(filter).sort({ entryDate: -1 }).limit(500);
  return rows.map(publicEntry);
}

/**
 * recordedProfit = sum(posted income) − sum(posted expenses) per currency.
 * Never includes milk litres, feed quantities, or marketplace inference.
 */
export async function summarize(account, query = {}) {
  const { farmerProfile } = await resolveFarmScope(account, query.farmerProfileId, 'finance.read');
  const match = {
    farmerProfileId: farmerProfile._id,
    status: 'posted',
  };
  if (query.from || query.to) {
    match.entryDate = {};
    if (query.from) match.entryDate.$gte = parseBusinessDate(query.from, { field: 'from' });
    if (query.to) match.entryDate.$lte = parseBusinessDate(query.to, { field: 'to' });
  }
  if (query.currency) match.currency = String(query.currency).toUpperCase();

  const groups = await FarmFinancialEntry.aggregate([
    { $match: match },
    {
      $group: {
        _id: { currency: '$currency', entryType: '$entryType' },
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
  ]);

  const byCurrency = {};
  for (const g of groups) {
    const cur = g._id.currency;
    if (!byCurrency[cur]) {
      byCurrency[cur] = {
        currency: cur,
        totalIncome: 0,
        totalExpense: 0,
        incomeCount: 0,
        expenseCount: 0,
        recordedProfit: 0,
      };
    }
    if (g._id.entryType === 'income') {
      byCurrency[cur].totalIncome = g.total;
      byCurrency[cur].incomeCount = g.count;
    } else if (g._id.entryType === 'expense') {
      byCurrency[cur].totalExpense = g.total;
      byCurrency[cur].expenseCount = g.count;
    }
  }
  for (const cur of Object.keys(byCurrency)) {
    byCurrency[cur].recordedProfit = byCurrency[cur].totalIncome - byCurrency[cur].totalExpense;
  }

  return {
    farmerProfileId: String(farmerProfile._id),
    byCurrency: Object.values(byCurrency),
    derivedFrom: 'FarmFinancialEntry.posted_only',
    includesMilkLitres: false,
    includesFeedQuantities: false,
    includesMarketplaceInference: false,
  };
}

export { publicEntry, ENTRY_TYPES };
