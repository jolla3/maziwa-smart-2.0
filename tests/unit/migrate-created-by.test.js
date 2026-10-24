import { jest } from '@jest/globals';
import {
  planCreatedByBackfill,
  applyCreatedByBackfill,
  resolveLivestockAdCollectionName,
} from '../../src/modules/livestock-marketplace/migrateCreatedBy.js';

describe('createdByAccountId migration attribution rules', () => {
  test('does not treat advertiser as creator when fields would differ (manager vs advertiser)', () => {
    const docs = [
      {
        _id: 'ad-mgr',
        advertiserAccountId: 'farmer-seller-1',
        // createdBy missing — historically may have been created by manager-9
        farmerProfileId: 'farm-1',
      },
    ];
    const plan = planCreatedByBackfill(docs);
    expect(plan.eligibleCount).toBe(0);
    expect(plan.unresolvedAttributionCount).toBe(1);
    expect(plan.unresolvedAttribution[0]._id).toBe('ad-mgr');
    expect(plan.intendedModifications).toEqual([]);
  });

  test('counts existing creator values when scanning full set', () => {
    const plan = planCreatedByBackfill([
      { _id: '1', advertiserAccountId: 'a', createdByAccountId: 'creator-1' },
      { _id: '2', advertiserAccountId: 'b', createdByAccountId: 'creator-1' },
      { _id: '3', advertiserAccountId: 'c' },
    ]);
    expect(plan.scanned).toBe(3);
    expect(plan.existingCreator).toBe(2);
    expect(plan.unresolvedAttributionCount).toBe(1);
    expect(plan.eligibleCount).toBe(0);
  });

  test('missing advertiser and missing creator reported separately', () => {
    const plan = planCreatedByBackfill([
      { _id: 'x' },
      { _id: 'y', advertiserAccountId: 'a1' },
    ]);
    expect(plan.missingAdvertiserCount).toBe(1);
    expect(plan.unresolvedAttributionCount).toBe(1);
    expect(plan.eligibleCount).toBe(0);
  });

  test('never proposes advertiser→creator substitution even when advertiser present', () => {
    const plan = planCreatedByBackfill([
      { _id: '1', advertiserAccountId: 'same-account' },
    ]);
    expect(plan.eligible).toEqual([]);
    expect(plan.intendedModifications).toEqual([]);
  });

  test('apply is idempotent and modifies zero when nothing eligible', async () => {
    const docs = [
      { _id: '1', advertiserAccountId: 'a', createdByAccountId: 'c' },
      { _id: '2', advertiserAccountId: 'b' },
    ];
    const updateOne = jest.fn();
    const collection = {
      find: () => ({
        toArray: async () => docs,
      }),
      updateOne,
    };
    const dry = await applyCreatedByBackfill(collection, { apply: false });
    expect(dry.modified).toBe(0);
    expect(dry.existingCreator).toBe(1);
    expect(dry.unresolvedAttributionCount).toBe(1);
    expect(updateOne).not.toHaveBeenCalled();

    const applied = await applyCreatedByBackfill(collection, { apply: true });
    expect(applied.modified).toBe(0);
    expect(updateOne).not.toHaveBeenCalled();
  });

  test('resolveLivestockAdCollectionName uses model collection name', () => {
    expect(resolveLivestockAdCollectionName({ collection: { name: 'livestockads' } })).toBe('livestockads');
    expect(() => resolveLivestockAdCollectionName({})).toThrow(/collection name/);
  });
});
