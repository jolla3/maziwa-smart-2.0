import { jest } from '@jest/globals';
import { AppError } from '../../src/shared/errors/AppError.js';

const resolveFarmScope = jest.fn();
const listAnimals = jest.fn();
const summarizeYields = jest.fn();
const financeSummarize = jest.fn();
const listHealth = jest.fn();
const listBreeding = jest.fn();
const listFeed = jest.fn();

jest.unstable_mockModule('../../src/shared/farm/resolveScope.js', () => ({ resolveFarmScope }));
jest.unstable_mockModule('../../src/modules/animals/service.js', () => ({
  listAnimals,
  assertAnimalInFarm: jest.fn(),
  publicAnimal: jest.fn(),
}));
jest.unstable_mockModule('../../src/modules/milk-production/service.js', () => ({
  summarizeYields,
  listYields: jest.fn(),
  recordYield: jest.fn(),
}));
jest.unstable_mockModule('../../src/modules/farm-finance/service.js', () => ({
  summarize: financeSummarize,
  createEntry: jest.fn(),
  listEntries: jest.fn(),
}));
jest.unstable_mockModule('../../src/modules/animal-health/service.js', () => ({
  listRecords: listHealth,
  createRecord: jest.fn(),
}));
jest.unstable_mockModule('../../src/modules/breeding/service.js', () => ({
  listEvents: listBreeding,
  createEvent: jest.fn(),
}));
jest.unstable_mockModule('../../src/modules/feed-management/service.js', () => ({
  listRecords: listFeed,
  createRecord: jest.fn(),
}));

const {
  getDashboard,
  getFinanceSummary,
  getMilkTrends,
} = await import('../../src/modules/analytics/service.js');

const owner = { _id: 'owner-1' };
const manager = { _id: 'mgr-1' };
const farmerId = 'farm-1';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('analytics dashboard', () => {
  test('owner can load dashboard sections', async () => {
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    listAnimals.mockResolvedValue([
      { id: 'a1', status: 'active', species: 'cattle' },
      { id: 'a2', status: 'active', species: 'cattle' },
    ]);
    summarizeYields.mockResolvedValue({ totalLitres: 120, recordCount: 4, farmerProfileId: farmerId });
    financeSummarize.mockResolvedValue({
      farmerProfileId: farmerId,
      byCurrency: [{ currency: 'KES', totalIncome: 10000, totalExpense: 3000, recordedProfit: 7000 }],
      includesMilkLitres: false,
    });
    listHealth.mockResolvedValue([{ eventType: 'vaccination' }]);
    listBreeding.mockResolvedValue([{ eventType: 'heat' }, { eventType: 'heat' }]);
    listFeed.mockResolvedValue([{ recordType: 'usage', quantity: 10 }]);

    const d = await getDashboard(owner, {});
    expect(d.farmerProfileId).toBe(farmerId);
    expect(d.invariants.readOnly).toBe(true);
    expect(d.invariants.milkLitresAreNotIncome).toBe(true);
    expect(d.sections.herd.totalAnimals).toBe(2);
    expect(d.sections.milk.totalLitres).toBe(120);
    expect(d.sections.milk.representsIncome).toBe(false);
    expect(d.sections.finance.byCurrency[0].recordedProfit).toBe(7000);
    expect(d.sections.feed.representsExpense).toBe(false);
    expect(listAnimals).toHaveBeenCalled();
    // analytics does not call write APIs
  });

  test('delegate needs analytics.read', async () => {
    resolveFarmScope.mockRejectedValue(new AppError(403, 'FORBIDDEN', 'missing analytics.read'));
    await expect(getDashboard(manager, { farmerProfileId: farmerId }))
      .rejects.toMatchObject({ status: 403 });
  });

  test('cross-farm request denied at analytics gate', async () => {
    resolveFarmScope.mockRejectedValue(new AppError(403, 'FORBIDDEN', 'wrong farm'));
    await expect(getDashboard(owner, { farmerProfileId: 'farm-other' }))
      .rejects.toMatchObject({ status: 403 });
  });

  test('analytics.read without finance.read marks finance unavailable', async () => {
    resolveFarmScope.mockResolvedValue({
      mode: 'delegate',
      farmerProfile: { _id: farmerId },
      grant: { permissions: ['analytics.read'] },
    });
    listAnimals.mockResolvedValue([]);
    summarizeYields.mockResolvedValue({ totalLitres: 0, recordCount: 0 });
    financeSummarize.mockRejectedValue(new AppError(403, 'FORBIDDEN', 'missing finance.read'));
    listHealth.mockResolvedValue([]);
    listBreeding.mockResolvedValue([]);
    listFeed.mockResolvedValue([]);

    const d = await getDashboard(manager, {
      farmerProfileId: farmerId,
      sections: 'herd,finance',
    });
    expect(d.sections.herd.available).toBe(true);
    expect(d.sections.finance.available).toBe(false);
    expect(d.sections.finance.reason).toBe('FORBIDDEN');
  });

  test('multi-currency finance passes through without mixing', async () => {
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    financeSummarize.mockResolvedValue({
      farmerProfileId: farmerId,
      byCurrency: [
        { currency: 'KES', totalIncome: 100, totalExpense: 40, recordedProfit: 60 },
        { currency: 'USD', totalIncome: 10, totalExpense: 2, recordedProfit: 8 },
      ],
      includesMilkLitres: false,
      includesMarketplaceInference: false,
    });
    const fin = await getFinanceSummary(owner, {});
    expect(fin.available).toBe(true);
    expect(fin.byCurrency).toHaveLength(2);
    expect(fin.includesMilkLitres).toBe(false);
  });

  test('milk trends flag litres as non-income', async () => {
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    summarizeYields.mockResolvedValue({ totalLitres: 50, recordCount: 2 });
    const m = await getMilkTrends(owner, { from: '2026-01-01', to: '2026-01-31' });
    expect(m.representsIncome).toBe(false);
    expect(m.totalLitres).toBe(50);
  });

  test('revoked grant denies dashboard', async () => {
    resolveFarmScope.mockRejectedValue(new AppError(403, 'FORBIDDEN', 'revoked'));
    await expect(getDashboard(manager, { farmerProfileId: farmerId }))
      .rejects.toMatchObject({ status: 403 });
  });
});

describe('analytics module boundary', () => {
  test('service source does not import private models', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(
      new URL('../../src/modules/analytics/service.js', import.meta.url),
      'utf8',
    );
    expect(src).not.toMatch(/from ['\"].*\/model\.js['\"]/);
    expect(src).not.toMatch(/mongoose/);
    expect(src).toMatch(/from ['\"]\.\.\/animals\/service\.js['\"]/);
    expect(src).toMatch(/from ['\"]\.\.\/farm-finance\/service\.js['\"]/);
  });
});
