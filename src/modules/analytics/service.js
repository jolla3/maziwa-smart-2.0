/**
 * Read-only analytics orchestration.
 * Does not own source-of-truth data. Never writes domain records.
 * analytics.read is required for the dashboard shell; each section still
 * enforces the underlying domain permission via public source APIs.
 */
import { AppError } from '../../shared/errors/AppError.js';
import { resolveFarmScope } from '../../shared/farm/resolveScope.js';
import * as animalsService from '../animals/service.js';
import * as milkService from '../milk-production/service.js';
import * as financeService from '../farm-finance/service.js';
import * as healthService from '../animal-health/service.js';
import * as breedingService from '../breeding/service.js';
import * as feedService from '../feed-management/service.js';

function sectionUnavailable(error) {
  if (error instanceof AppError) {
    return {
      available: false,
      reason: error.code || 'FORBIDDEN',
      message: error.message,
    };
  }
  throw error;
}

/**
 * Gate: owner or analytics.read for the requested farmer scope.
 * Underlying domain reads still re-authorize.
 */
async function requireAnalyticsScope(account, farmerProfileId) {
  return resolveFarmScope(account, farmerProfileId, 'analytics.read');
}

async function herdSummary(account, farmerProfileId) {
  const animals = await animalsService.listAnimals(account, { farmerProfileId });
  const byStatus = {};
  const bySpecies = {};
  for (const a of animals) {
    const st = a.status || 'unknown';
    const sp = a.species || 'unknown';
    byStatus[st] = (byStatus[st] || 0) + 1;
    bySpecies[sp] = (bySpecies[sp] || 0) + 1;
  }
  return {
    available: true,
    totalAnimals: animals.length,
    byStatus,
    bySpecies,
    // Exact advanced metrics remain product-open per SERVICE_CONTRACTS.
  };
}

async function milkSummary(account, farmerProfileId, query) {
  const summary = await milkService.summarizeYields(account, {
    farmerProfileId,
    from: query.from,
    to: query.to,
    animalId: query.animalId,
  });
  return {
    available: true,
    ...summary,
    // Explicit: litres are production quantities, not income.
    representsIncome: false,
  };
}

async function financeSummary(account, farmerProfileId, query) {
  const summary = await financeService.summarize(account, {
    farmerProfileId,
    from: query.from,
    to: query.to,
    currency: query.currency,
  });
  return {
    available: true,
    ...summary,
  };
}

async function healthSummary(account, farmerProfileId, query) {
  const records = await healthService.listRecords(account, {
    farmerProfileId,
    from: query.from,
    to: query.to,
  });
  const byEventType = {};
  for (const r of records) {
    const t = r.eventType || 'other';
    byEventType[t] = (byEventType[t] || 0) + 1;
  }
  return {
    available: true,
    recordCount: records.length,
    byEventType,
  };
}

async function breedingSummary(account, farmerProfileId, query) {
  const events = await breedingService.listEvents(account, {
    farmerProfileId,
    from: query.from,
    to: query.to,
  });
  const byEventType = {};
  for (const e of events) {
    const t = e.eventType || 'other';
    byEventType[t] = (byEventType[t] || 0) + 1;
  }
  return {
    available: true,
    eventCount: events.length,
    byEventType,
  };
}

async function feedSummary(account, farmerProfileId, query) {
  const records = await feedService.listRecords(account, {
    farmerProfileId,
    from: query.from,
    to: query.to,
  });
  let totalQuantity = 0;
  const byRecordType = {};
  for (const r of records) {
    const t = r.recordType || 'other';
    byRecordType[t] = (byRecordType[t] || 0) + 1;
    if (typeof r.quantity === 'number') totalQuantity += r.quantity;
  }
  return {
    available: true,
    recordCount: records.length,
    totalQuantity,
    byRecordType,
    // Explicit: feed quantities are not expenses.
    representsExpense: false,
  };
}

/**
 * Dashboard aggregate. Optional `sections` query limits work (comma list).
 * Default sections: herd, milk, finance, health, breeding, feed.
 */
export async function getDashboard(account, query = {}) {
  const { farmerProfile } = await requireAnalyticsScope(account, query.farmerProfileId);
  const farmerProfileId = farmerProfile._id;
  const scopeQuery = {
    from: query.from,
    to: query.to,
    animalId: query.animalId,
    currency: query.currency,
  };

  const requested = query.sections
    ? String(query.sections).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : ['herd', 'milk', 'finance', 'health', 'breeding', 'feed'];

  const dashboard = {
    farmerProfileId: String(farmerProfileId),
    period: {
      from: query.from || null,
      to: query.to || null,
    },
    sections: {},
    invariants: {
      readOnly: true,
      inventsRevenue: false,
      inventsExpenses: false,
      milkLitresAreNotIncome: true,
      feedQuantitiesAreNotExpenses: true,
    },
  };

  const runners = {
    herd: () => herdSummary(account, farmerProfileId),
    milk: () => milkSummary(account, farmerProfileId, scopeQuery),
    finance: () => financeSummary(account, farmerProfileId, scopeQuery),
    health: () => healthSummary(account, farmerProfileId, scopeQuery),
    breeding: () => breedingSummary(account, farmerProfileId, scopeQuery),
    feed: () => feedSummary(account, farmerProfileId, scopeQuery),
  };

  for (const key of requested) {
    if (!runners[key]) continue;
    try {
      dashboard.sections[key] = await runners[key]();
    } catch (error) {
      dashboard.sections[key] = sectionUnavailable(error);
    }
  }

  return dashboard;
}

/** Focused milk trends — litres only. */
export async function getMilkTrends(account, query = {}) {
  const { farmerProfile } = await requireAnalyticsScope(account, query.farmerProfileId);
  try {
    return await milkSummary(account, farmerProfile._id, query);
  } catch (error) {
    return sectionUnavailable(error);
  }
}

/** Focused finance summary — requires finance.read via farm-finance. */
export async function getFinanceSummary(account, query = {}) {
  const { farmerProfile } = await requireAnalyticsScope(account, query.farmerProfileId);
  try {
    return await financeSummary(account, farmerProfile._id, query);
  } catch (error) {
    return sectionUnavailable(error);
  }
}

/** Focused herd summary. */
export async function getHerdSummary(account, query = {}) {
  const { farmerProfile } = await requireAnalyticsScope(account, query.farmerProfileId);
  try {
    return await herdSummary(account, farmerProfile._id);
  } catch (error) {
    return sectionUnavailable(error);
  }
}
