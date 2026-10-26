import { afterAll, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Favourite } from '../../src/modules/favourites/model.js';
import * as favouritesService from '../../src/modules/favourites/service.js';
import { LivestockAd } from '../../src/modules/livestock-marketplace/model.js';

let memoryServer;
const accountA = new mongoose.Types.ObjectId();
const accountB = new mongoose.Types.ObjectId();

async function createAd(overrides = {}) {
  return LivestockAd.create({
    advertiserAccountId: accountA,
    title: overrides.title || 'Test cow',
    species: 'cow',
    price: 1000,
    currency: 'KES',
    status: overrides.status || 'published',
    publishedAt: overrides.status === 'draft' ? undefined : new Date(),
    ...overrides,
  });
}

beforeAll(async () => {
  memoryServer = await MongoMemoryServer.create();
  await mongoose.connect(memoryServer.getUri('favourites_unit'));
  await Favourite.init();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
}, 60_000);

beforeEach(async () => {
  await Favourite.deleteMany({});
  await LivestockAd.deleteMany({});
});

describe('favourites service', () => {
  test('saves a published ad and is idempotent', async () => {
    const ad = await createAd({ status: 'published' });
    const first = await favouritesService.saveFavourite(accountA, ad._id);
    const second = await favouritesService.saveFavourite(accountA, ad._id);
    expect(first.saved).toBe(true);
    expect(second.saved).toBe(true);
    expect(await Favourite.countDocuments({ accountId: accountA })).toBe(1);
  });

  test('rejects draft, closed, archived and nonexistent ads', async () => {
    const draft = await createAd({ status: 'draft' });
    const closed = await createAd({ status: 'closed' });
    const archived = await createAd({ status: 'archived' });
    await expect(favouritesService.saveFavourite(accountA, draft._id)).rejects.toMatchObject({
      status: 404,
      code: 'AD_NOT_FOUND',
    });
    await expect(favouritesService.saveFavourite(accountA, closed._id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(favouritesService.saveFavourite(accountA, archived._id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      favouritesService.saveFavourite(accountA, new mongoose.Types.ObjectId()),
    ).rejects.toMatchObject({ status: 404 });
  });

  test('list returns unavailable placeholder without leaking private fields', async () => {
    const published = await createAd({ status: 'published', title: 'Visible cow' });
    const laterArchived = await createAd({ status: 'published', title: 'Secret title' });
    await favouritesService.saveFavourite(accountA, published._id);
    await favouritesService.saveFavourite(accountA, laterArchived._id);
    laterArchived.status = 'archived';
    await laterArchived.save();

    const list = await favouritesService.listFavourites(accountA, { page: 1, limit: 20 });
    expect(list.total).toBe(2);
    expect(list.items).toHaveLength(2);
    const avail = list.items.find((i) => i.livestockAdId === String(published._id));
    const unavail = list.items.find((i) => i.livestockAdId === String(laterArchived._id));
    expect(avail.availability).toBe('available');
    expect(avail.ad.title).toBe('Visible cow');
    expect(avail.ad.advertiserAccountId).toBeUndefined();
    expect(unavail.availability).toBe('unavailable');
    expect(unavail.ad).toBeNull();
    expect(JSON.stringify(unavail)).not.toMatch(/Secret title|advertiserAccountId|farmerProfileId/);
  });

  test('delete is idempotent and scoped to account', async () => {
    const ad = await createAd({ status: 'published' });
    await favouritesService.saveFavourite(accountA, ad._id);
    await favouritesService.saveFavourite(accountB, ad._id);
    const r1 = await favouritesService.removeFavourite(accountA, ad._id);
    const r2 = await favouritesService.removeFavourite(accountA, ad._id);
    expect(r1.saved).toBe(false);
    expect(r2.saved).toBe(false);
    expect(await Favourite.countDocuments({ accountId: accountA })).toBe(0);
    expect(await Favourite.countDocuments({ accountId: accountB })).toBe(1);
  });

  test('pagination and stable order', async () => {
    const ads = [];
    for (let i = 0; i < 5; i += 1) {
      const ad = await createAd({ status: 'published', title: `Cow ${i}` });
      ads.push(ad);
      await favouritesService.saveFavourite(accountA, ad._id);
    }
    const page1 = await favouritesService.listFavourites(accountA, { page: 1, limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.totalPages).toBe(3);
    // Newest save first
    expect(page1.items[0].livestockAdId).toBe(String(ads[4]._id));
  });

  test('unique compound index rejects duplicate inserts', async () => {
    const ad = await createAd({ status: 'published' });
    await Favourite.create({ accountId: accountA, livestockAdId: ad._id });
    await expect(
      Favourite.create({ accountId: accountA, livestockAdId: ad._id }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  test('concurrent saves produce one relationship', async () => {
    const ad = await createAd({ status: 'published' });
    await Promise.all(
      Array.from({ length: 8 }, () => favouritesService.saveFavourite(accountA, ad._id)),
    );
    expect(await Favourite.countDocuments({ accountId: accountA, livestockAdId: ad._id })).toBe(1);
  });
});
