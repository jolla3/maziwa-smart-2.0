import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AppError } from '../../src/shared/errors/AppError.js';

const root = path.dirname(fileURLToPath(import.meta.url));

describe('HTTP cache headers for public marketplace', () => {
  test('public controllers use no-store rather than max-age=30', () => {
    const src = readFileSync(path.join(root, '../../src/modules/livestock-marketplace/controller.js'), 'utf8');
    expect(src).toMatch(/no-store/);
    expect(src).not.toMatch(/max-age=30/);
  });
});

describe('mediaLifecycle pure helpers', () => {
  test('collectPublicIds extracts ids from multer and meta shapes', async () => {
    const { collectPublicIds } = await import('../../src/integrations/media-storage/mediaLifecycle.js');
    expect(collectPublicIds([
      { public_id: 'a' },
      { publicId: 'b' },
      { filename: 'c' },
      { url: 'https://x' },
    ])).toEqual(['a', 'b', 'c']);
  });
});

describe('mediaLifecycle destroy with mocked cloudinary', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('compensateFailedUpload destroys pending ids and retries', async () => {
    const destroyCloudinaryAsset = jest.fn()
      .mockRejectedValueOnce(new Error('temp'))
      .mockResolvedValueOnce({ result: 'ok' })
      .mockResolvedValue({ result: 'ok' });

    jest.unstable_mockModule('../../src/integrations/media-storage/cloudinary.js', () => ({
      destroyCloudinaryAsset,
      isCloudinaryConfigured: () => true,
      getCloudinary: jest.fn(),
    }));
    jest.unstable_mockModule('../../src/config/logger.js', () => ({
      logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
    }));

    const { compensateFailedUpload, destroyAssets } = await import('../../src/integrations/media-storage/mediaLifecycle.js');
    const result = await destroyAssets(['pending-1'], { retries: 1 });
    expect(result.destroyed).toEqual(['pending-1']);
    expect(destroyCloudinaryAsset).toHaveBeenCalledTimes(2);

    destroyCloudinaryAsset.mockClear();
    destroyCloudinaryAsset.mockResolvedValue({ result: 'ok' });
    const comp = await compensateFailedUpload(['orphan-a', 'orphan-b']);
    expect(comp.destroyed).toEqual(expect.arrayContaining(['orphan-a', 'orphan-b']));
  });

  test('destroyAssets records permanent failures', async () => {
    const destroyCloudinaryAsset = jest.fn().mockRejectedValue(new Error('permanent'));
    jest.unstable_mockModule('../../src/integrations/media-storage/cloudinary.js', () => ({
      destroyCloudinaryAsset,
      isCloudinaryConfigured: () => true,
      getCloudinary: jest.fn(),
    }));
    jest.unstable_mockModule('../../src/config/logger.js', () => ({
      logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
    }));
    const { destroyAssets } = await import('../../src/integrations/media-storage/mediaLifecycle.js');
    const result = await destroyAssets(['bad'], { retries: 1 });
    expect(result.destroyed).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].publicId).toBe('bad');
  });
});

describe('image replace ordering and views', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  async function loadService(mocks) {
    jest.unstable_mockModule('../../src/modules/farm-access/service.js', () => ({
      authorizeFarmAccess: mocks.authorizeFarmAccess || jest.fn(),
      findOwnedFarmerProfile: jest.fn(),
      listGrantsForRecipient: jest.fn(async () => []),
    }));
    jest.unstable_mockModule('../../src/modules/animals/service.js', () => ({
      assertAnimalInFarm: jest.fn(),
    }));
    jest.unstable_mockModule('../../src/modules/sellers/model.js', () => ({
      SellerProfile: {
        findOne: mocks.SellerProfileFindOne || jest.fn(),
        create: jest.fn(),
      },
    }));
    jest.unstable_mockModule('../../src/shared/cache/productSingleFlight.js', () => ({
      getOrLoadPublicProduct: mocks.getOrLoadPublicProduct || jest.fn(async ({ loader }) => loader()),
      invalidatePublicProduct: mocks.invalidatePublicProduct || jest.fn(async () => ({ ok: true })),
    }));
    jest.unstable_mockModule('../../src/integrations/media-storage/cloudinary.js', () => ({
      destroyCloudinaryAsset: mocks.destroyCloudinaryAsset || jest.fn(async () => ({ result: 'ok' })),
      isCloudinaryConfigured: () => true,
      getCloudinary: jest.fn(),
    }));
    jest.unstable_mockModule('../../src/config/logger.js', () => ({
      logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
    }));
    jest.unstable_mockModule('../../src/modules/livestock-marketplace/model.js', () => ({
      LivestockAd: {
        findById: mocks.LivestockAdFindById || jest.fn(),
        create: mocks.LivestockAdCreate || jest.fn(),
        findOneAndUpdate: mocks.findOneAndUpdate || jest.fn(),
        find: jest.fn(),
        countDocuments: jest.fn(),
      },
      AdViewEvent: { create: mocks.AdViewEventCreate || jest.fn() },
      AD_STATUSES: ['draft', 'published', 'closed', 'archived'],
      SPECIES: ['cow', 'goat', 'sheep', 'pig', 'other'],
    }));
    return import('../../src/modules/livestock-marketplace/service.js');
  }

  test('successful image replace commits new images then destroys only old ids', async () => {
    const destroyCloudinaryAsset = jest.fn(async () => ({ result: 'ok' }));
    const save = jest.fn(async function save() { return this; });
    const ad = {
      _id: 'ad-1',
      advertiserAccountId: 'acc-1',
      farmerProfileId: null,
      status: 'draft',
      images: [{ url: 'https://old', publicId: 'old-1' }],
      save,
    };
    const service = await loadService({
      destroyCloudinaryAsset,
      LivestockAdFindById: jest.fn().mockResolvedValue(ad),
      invalidatePublicProduct: jest.fn(async () => ({ ok: true })),
    });

    await service.updateAd(
      { _id: 'acc-1' },
      'ad-1',
      { replaceImages: true, title: 'Updated' },
      [{ url: 'https://new', publicId: 'new-1' }],
    );

    expect(save).toHaveBeenCalled();
    expect(ad.images[0].publicId).toBe('new-1');
    expect(destroyCloudinaryAsset).toHaveBeenCalledWith('old-1');
    expect(destroyCloudinaryAsset).not.toHaveBeenCalledWith('new-1');
  });

  test('if save fails after planning replace, old assets are not destroyed', async () => {
    const destroyCloudinaryAsset = jest.fn(async () => ({ result: 'ok' }));
    const save = jest.fn(async () => { throw new Error('db fail'); });
    const ad = {
      _id: 'ad-1',
      advertiserAccountId: 'acc-1',
      farmerProfileId: null,
      status: 'draft',
      images: [{ url: 'https://old', publicId: 'old-1' }],
      save,
    };
    const service = await loadService({
      destroyCloudinaryAsset,
      LivestockAdFindById: jest.fn().mockResolvedValue(ad),
    });

    await expect(service.updateAd(
      { _id: 'acc-1' },
      'ad-1',
      { replaceImages: true },
      [{ url: 'https://new', publicId: 'new-1' }],
    )).rejects.toThrow('db fail');
    expect(destroyCloudinaryAsset).not.toHaveBeenCalled();
  });

  test('recordPublicView atomic increment invalidates after event failure', async () => {
    const invalidatePublicProduct = jest.fn(async () => ({ ok: true }));
    const findOneAndUpdate = jest.fn().mockResolvedValue({
      _id: 'ad-1', status: 'published', viewCount: 5,
    });
    const AdViewEventCreate = jest.fn().mockRejectedValue(new Error('event write failed'));
    const service = await loadService({
      findOneAndUpdate,
      AdViewEventCreate,
      invalidatePublicProduct,
    });

    const result = await service.recordPublicView('ad-1', null);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'ad-1', status: 'published' },
      { $inc: { viewCount: 1 } },
      { new: true },
    );
    expect(result.viewCount).toBe(5);
    expect(result.eventRecorded).toBe(false);
    expect(invalidatePublicProduct).toHaveBeenCalled();
  });

  test('closed or archived ads are not returned by getPublicAd loader', async () => {
    const findById = jest.fn().mockResolvedValue({ _id: 'ad-1', status: 'archived', title: 'x' });
    const getOrLoadPublicProduct = jest.fn(async ({ loader }) => loader());
    const service = await loadService({
      LivestockAdFindById: findById,
      getOrLoadPublicProduct,
    });
    await expect(service.getPublicAd('ad-1')).rejects.toMatchObject({ code: 'AD_NOT_FOUND' });
  });
});
