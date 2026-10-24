import { jest } from '@jest/globals';
import { AppError } from '../../src/shared/errors/AppError.js';

const resolveFarmScope = jest.fn();
const assertAnimalInFarm = jest.fn();
const Find = jest.fn();
const FindById = jest.fn();
const Create = jest.fn();
const Aggregate = jest.fn();

jest.unstable_mockModule('../../src/shared/farm/resolveScope.js', () => ({ resolveFarmScope }));
jest.unstable_mockModule('../../src/modules/animals/service.js', () => ({
  assertAnimalInFarm,
  publicAnimal: jest.fn(),
}));
jest.unstable_mockModule('../../src/modules/farm-finance/model.js', () => ({
  FarmFinancialEntry: {
    find: Find,
    findById: FindById,
    create: Create,
    aggregate: Aggregate,
  },
  ENTRY_TYPES: ['income', 'expense'],
}));

const {
  createEntry,
  listEntries,
  getEntry,
  updateEntry,
  voidEntry,
  summarize,
} = await import('../../src/modules/farm-finance/service.js');

const owner = { _id: 'owner-1' };
const manager = { _id: 'mgr-1' };
const farmerId = 'farm-1';

function doc(overrides = {}) {
  return {
    _id: 'e1',
    farmerProfileId: farmerId,
    entryType: 'income',
    amount: 1000,
    currency: 'KES',
    category: 'milk_sales',
    entryDate: new Date(Date.UTC(2026, 0, 15)),
    status: 'posted',
    save: jest.fn(async function s() { return this; }),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  assertAnimalInFarm.mockResolvedValue({ _id: 'a1', farmerProfileId: farmerId });
});

describe('farm-finance', () => {
  test('owner records explicit income and expense with correct permissions', async () => {
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    Create.mockImplementation(async (d) => ({ _id: 'e1', status: 'posted', ...d }));

    const income = await createEntry(owner, {
      entryType: 'income', amount: 12000, category: 'milk_sales', entryDate: '2026-01-15',
    });
    expect(income.entryType).toBe('income');
    expect(income.entryDate).toBe('2026-01-15');
    expect(resolveFarmScope).toHaveBeenCalledWith(owner, undefined, 'finance.record_income');

    await createEntry(owner, {
      entryType: 'expense', amount: 5000, category: 'feed', entryDate: '2026-01-16', currency: 'KES',
    });
    expect(resolveFarmScope).toHaveBeenCalledWith(owner, undefined, 'finance.record_expense');
  });

  test('delegate needs finance.record_income specifically', async () => {
    resolveFarmScope.mockRejectedValue(new AppError(403, 'FORBIDDEN', 'missing'));
    await expect(createEntry(manager, {
      farmerProfileId: farmerId,
      entryType: 'income', amount: 100, category: 'sale', entryDate: '2026-01-15',
    })).rejects.toMatchObject({ status: 403 });
  });

  test('rejects invalid amount currency date and missing category', async () => {
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    await expect(createEntry(owner, {
      entryType: 'income', amount: -1, category: 'x', entryDate: '2026-01-15',
    })).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
    await expect(createEntry(owner, {
      entryType: 'income', amount: 1, category: 'x', entryDate: '2026-01-15', currency: 'SHILLING',
    })).rejects.toMatchObject({ code: 'INVALID_CURRENCY' });
    await expect(createEntry(owner, {
      entryType: 'income', amount: 1, category: 'x', entryDate: '2026-01-15T10:00:00',
    })).rejects.toMatchObject({ code: 'INVALID_DATE' });
    await expect(createEntry(owner, {
      entryType: 'income', amount: 1, entryDate: '2026-01-15',
    })).rejects.toMatchObject({ code: 'CATEGORY_REQUIRED' });
  });

  test('cross-farmer animal on entry is denied', async () => {
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    assertAnimalInFarm.mockRejectedValue(new AppError(403, 'ANIMAL_SCOPE_MISMATCH', 'no'));
    await expect(createEntry(owner, {
      entryType: 'expense', amount: 50, category: 'vet', entryDate: '2026-01-15', animalId: 'foreign',
    })).rejects.toMatchObject({ code: 'ANIMAL_SCOPE_MISMATCH' });
  });

  test('update cannot change farmer or entryType', async () => {
    const row = doc();
    FindById.mockResolvedValue(row);
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    await expect(updateEntry(owner, 'e1', { farmerProfileId: 'farm-x' }))
      .rejects.toMatchObject({ code: 'FINANCE_SCOPE_IMMUTABLE' });
    await expect(updateEntry(owner, 'e1', { entryType: 'expense' }))
      .rejects.toMatchObject({ code: 'ENTRY_TYPE_IMMUTABLE' });
  });

  test('getEntry and list require finance.read', async () => {
    resolveFarmScope.mockRejectedValue(new AppError(403, 'FORBIDDEN', 'revoked'));
    await expect(listEntries(manager, { farmerProfileId: farmerId })).rejects.toMatchObject({ status: 403 });
    FindById.mockResolvedValue(doc());
    await expect(getEntry(manager, 'e1')).rejects.toMatchObject({ status: 403 });
  });

  test('summary is posted-only profit by currency without milk inference', async () => {
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    Aggregate.mockResolvedValue([
      { _id: { currency: 'KES', entryType: 'income' }, total: 20000, count: 2 },
      { _id: { currency: 'KES', entryType: 'expense' }, total: 6500, count: 2 },
    ]);
    const s = await summarize(owner, {});
    expect(s.byCurrency[0].recordedProfit).toBe(13500);
    expect(s.includesMilkLitres).toBe(false);
    expect(s.includesFeedQuantities).toBe(false);
    expect(s.includesMarketplaceInference).toBe(false);
    expect(s.derivedFrom).toBe('FarmFinancialEntry.posted_only');
  });

  test('void requires finance.update and marks void', async () => {
    const row = doc();
    FindById.mockResolvedValue(row);
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    const out = await voidEntry(owner, 'e1');
    expect(out.status).toBe('void');
    expect(resolveFarmScope).toHaveBeenCalledWith(owner, farmerId, 'finance.update');
  });
});

describe('finance isolation from operational modules', () => {
  test('milk and feed services do not import farm-finance module', async () => {
    const fs = await import('node:fs');
    const milk = fs.readFileSync(new URL('../../src/modules/milk-production/service.js', import.meta.url), 'utf8');
    const feed = fs.readFileSync(new URL('../../src/modules/feed-management/service.js', import.meta.url), 'utf8');
    expect(milk).not.toMatch(/from ['\"].*farm-finance/);
    expect(feed).not.toMatch(/from ['\"].*farm-finance/);
    expect(feed).toMatch(/createsFinanceEntry:\s*false/);
  });
});
