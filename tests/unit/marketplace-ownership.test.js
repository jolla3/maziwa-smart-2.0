import { jest } from '@jest/globals';
import { AppError } from '../../src/shared/errors/AppError.js';
import { toPublicAdDto, toOwnerAdDto } from '../../src/modules/livestock-marketplace/publicDto.js';

const authorizeFarmAccess = jest.fn();
const findOwnedFarmerProfile = jest.fn();
const listGrantsForRecipient = jest.fn();
const assertAnimalInFarm = jest.fn();
const SellerProfileFindOne = jest.fn();
const LivestockAdFind = jest.fn();
const LivestockAdFindById = jest.fn();
const LivestockAdCreate = jest.fn();

jest.unstable_mockModule('../../src/modules/farm-access/service.js', () => ({
  authorizeFarmAccess,
  findOwnedFarmerProfile,
  listGrantsForRecipient,
}));

jest.unstable_mockModule('../../src/modules/animals/service.js', () => ({
  assertAnimalInFarm,
  publicAnimal: jest.fn(),
}));

jest.unstable_mockModule('../../src/modules/sellers/service.js', () => ({
  assertVerifiedForPublish: async (accountId) => {
    const seller = await SellerProfileFindOne({ accountId });
    if (!seller) {
      const { AppError } = await import('../../src/shared/errors/AppError.js');
      throw new AppError(403, 'SELLER_PROFILE_REQUIRED', 'A seller profile is required to publish listings');
    }
    if (seller.verificationStatus !== 'verified') {
      const { AppError } = await import('../../src/shared/errors/AppError.js');
      throw new AppError(403, 'SELLER_NOT_VERIFIED', 'Seller must be verified before publishing listings');
    }
    return seller;
  },
  ensureSellerProfile: jest.fn(async (account) => ({
    accountId: String(account._id),
    verificationStatus: 'pending',
  })),
  isVerifiedSeller: async (accountId) => {
    const seller = await SellerProfileFindOne({ accountId });
    return Boolean(seller && seller.verificationStatus === 'verified');
  },
  getMySellerProfile: jest.fn(),
  setVerificationStatus: jest.fn(),
}));

jest.unstable_mockModule('../../src/shared/cache/productSingleFlight.js', () => ({
  getOrLoadPublicProduct: jest.fn(async ({ loader }) => loader()),
  invalidatePublicProduct: jest.fn(async () => {}),
}));

jest.unstable_mockModule('../../src/integrations/media-storage/cloudinary.js', () => ({
  destroyCloudinaryAsset: jest.fn(async () => ({})),
}));

jest.unstable_mockModule('../../src/modules/livestock-marketplace/model.js', () => ({
  LivestockAd: {
    find: LivestockAdFind,
    findById: LivestockAdFindById,
    create: LivestockAdCreate,
    countDocuments: jest.fn(),
  },
  AdViewEvent: { create: jest.fn() },
  AD_STATUSES: ['draft', 'published', 'closed', 'archived'],
  SPECIES: ['cow', 'goat', 'sheep', 'pig', 'other'],
}));

const {
  assertCanManageAd,
  assertVerifiedSellerForPublish,
  listMyAds,
  createAd,
  updateAd,
} = await import('../../src/modules/livestock-marketplace/service.js');

const farmerId = 'farm-1';
const animalId = 'animal-1';
const ownerAccount = { _id: 'owner-1', role: 'farmer' };
const managerAccount = { _id: 'manager-1', role: 'buyer' };
const strangerAccount = { _id: 'stranger-1', role: 'buyer' };

function farmScopedAd(overrides = {}) {
  return {
    _id: 'ad-1',
    advertiserAccountId: 'manager-1',
    createdByAccountId: 'manager-1',
    farmerProfileId: farmerId,
    animalId,
    title: 'Dairy cow',
    status: 'draft',
    images: [{ url: 'https://example.test/a.jpg' }],
    save: jest.fn(async function save() { return this; }),
    ...overrides,
  };
}

function independentAd(overrides = {}) {
  return {
    _id: 'ad-ind',
    advertiserAccountId: 'manager-1',
    createdByAccountId: 'manager-1',
    farmerProfileId: null,
    title: 'Independent goat',
    status: 'draft',
    images: [{ url: 'https://example.test/b.jpg' }],
    save: jest.fn(async function save() { return this; }),
    ...overrides,
  };
}

describe('marketplace ownership authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('farm owner can manage a farm-scoped ad', async () => {
    authorizeFarmAccess.mockResolvedValueOnce({
      mode: 'owner',
      farmerProfile: { _id: farmerId, accountId: ownerAccount._id },
      grant: null,
    });
    const result = await assertCanManageAd(ownerAccount, farmScopedAd());
    expect(result.mode).toBe('farm_owner');
    expect(authorizeFarmAccess).toHaveBeenCalledWith(ownerAccount, farmerId, null);
  });

  test('manager with active marketplace.manage_farmer_ads grant can manage', async () => {
    authorizeFarmAccess
      .mockRejectedValueOnce(new AppError(403, 'FORBIDDEN', 'not owner'))
      .mockResolvedValueOnce({
        mode: 'delegate',
        farmerProfile: { _id: farmerId },
        grant: { permissions: ['marketplace.manage_farmer_ads'] },
      });
    const result = await assertCanManageAd(managerAccount, farmScopedAd());
    expect(result.mode).toBe('delegate');
    expect(authorizeFarmAccess).toHaveBeenLastCalledWith(
      managerAccount,
      farmerId,
      'marketplace.manage_farmer_ads',
    );
  });

  test('missing grant is denied for farm-scoped ad', async () => {
    authorizeFarmAccess
      .mockRejectedValueOnce(new AppError(403, 'FORBIDDEN', 'not owner'))
      .mockRejectedValueOnce(new AppError(403, 'FORBIDDEN', 'Missing delegated permission'));
    await expect(assertCanManageAd(managerAccount, farmScopedAd())).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
  });

  test('revoked creator cannot manage farm-scoped ad via advertiser or createdBy identity', async () => {
    // Manager is advertiser AND creator, but grant is gone.
    authorizeFarmAccess
      .mockRejectedValueOnce(new AppError(403, 'FORBIDDEN', 'not owner'))
      .mockRejectedValueOnce(new AppError(403, 'FORBIDDEN', 'Missing delegated permission'));
    const ad = farmScopedAd({
      advertiserAccountId: managerAccount._id,
      createdByAccountId: managerAccount._id,
    });
    await expect(assertCanManageAd(managerAccount, ad)).rejects.toMatchObject({ status: 403 });
  });

  test('advertiser identity cannot bypass farm authorization', async () => {
    authorizeFarmAccess
      .mockRejectedValueOnce(new AppError(403, 'FORBIDDEN', 'not owner'))
      .mockRejectedValueOnce(new AppError(403, 'FORBIDDEN', 'no grant'));
    const ad = farmScopedAd({ advertiserAccountId: strangerAccount._id });
    await expect(assertCanManageAd(strangerAccount, ad)).rejects.toMatchObject({ status: 403 });
  });

  test('independent ad management works for advertiser only', async () => {
    const ad = independentAd({ advertiserAccountId: managerAccount._id });
    const ok = await assertCanManageAd(managerAccount, ad);
    expect(ok.mode).toBe('advertiser');
    await expect(assertCanManageAd(strangerAccount, ad)).rejects.toMatchObject({ status: 403 });
    // Independent path must not consult farm grants
    expect(authorizeFarmAccess).not.toHaveBeenCalled();
  });

  test('listMyAds includes authorized and excludes revoked farm-scoped ads', async () => {
    findOwnedFarmerProfile.mockResolvedValue(null);
    listGrantsForRecipient.mockResolvedValue([
      {
        status: 'active',
        farmerProfileId: farmerId,
        permissions: ['marketplace.manage_farmer_ads'],
        expiresAt: null,
      },
      {
        status: 'revoked',
        farmerProfileId: 'farm-other',
        permissions: ['marketplace.manage_farmer_ads'],
      },
    ]);

    const allowed = farmScopedAd({ _id: 'allowed' });
    const independent = independentAd({ _id: 'ind', advertiserAccountId: managerAccount._id });
    LivestockAdFind.mockReturnValue({
      sort: () => ({
        limit: async () => [allowed, independent],
      }),
    });

    authorizeFarmAccess
      // assertCanManageAd for allowed farm ad: owner fail then delegate ok
      .mockRejectedValueOnce(new AppError(403, 'FORBIDDEN', 'not owner'))
      .mockResolvedValueOnce({
        mode: 'delegate',
        farmerProfile: { _id: farmerId },
        grant: { permissions: ['marketplace.manage_farmer_ads'] },
      });

    const list = await listMyAds(managerAccount, {});
    const ids = list.map((a) => a.id);
    expect(ids).toContain('allowed');
    expect(ids).toContain('ind');
  });

  test('listMyAds excludes farm ad when grant no longer authorizes', async () => {
    findOwnedFarmerProfile.mockResolvedValue(null);
    listGrantsForRecipient.mockResolvedValue([]); // candidate query may still be empty, force rows
    const ad = farmScopedAd({
      _id: 'stale',
      advertiserAccountId: managerAccount._id,
    });
    // Force a candidate that appears from advertiser independent clause only — farm-scoped
    // with advertiser match should still fail assertCanManageAd
    LivestockAdFind.mockReturnValue({
      sort: () => ({
        limit: async () => [ad],
      }),
    });
    authorizeFarmAccess
      .mockRejectedValueOnce(new AppError(403, 'FORBIDDEN', 'not owner'))
      .mockRejectedValueOnce(new AppError(403, 'FORBIDDEN', 'revoked'));

    const list = await listMyAds(managerAccount, {});
    expect(list.find((a) => a.id === 'stale')).toBeUndefined();
  });

  test('publish requires verified status on the acting seller account', async () => {
    SellerProfileFindOne.mockResolvedValue({ verificationStatus: 'pending' });
    await expect(assertVerifiedSellerForPublish(managerAccount._id)).rejects.toMatchObject({
      code: 'SELLER_NOT_VERIFIED',
    });

    SellerProfileFindOne.mockResolvedValue({ verificationStatus: 'verified' });
    await expect(assertVerifiedSellerForPublish(managerAccount._id)).resolves.toBeTruthy();
  });

  test('createAd rejects cross-farmer animal references', async () => {
    authorizeFarmAccess.mockResolvedValue({
      mode: 'owner',
      farmerProfile: { _id: farmerId, accountId: ownerAccount._id },
      grant: null,
    });
    assertAnimalInFarm.mockRejectedValue(new AppError(403, 'ANIMAL_SCOPE_MISMATCH', 'Animal does not belong to this farm'));
    SellerProfileFindOne.mockResolvedValue({ verificationStatus: 'pending' });

    await expect(createAd(ownerAccount, {
      title: 'Cow',
      species: 'cow',
      price: 1000,
      farmerProfileId: farmerId,
      animalId: 'other-farm-animal',
    })).rejects.toMatchObject({ code: 'ANIMAL_SCOPE_MISMATCH' });
  });

  test('updateAd refuses farm/animal/advertiser transfer fields', async () => {
    const ad = farmScopedAd();
    LivestockAdFindById.mockResolvedValue(ad);
    authorizeFarmAccess.mockResolvedValue({
      mode: 'owner',
      farmerProfile: { _id: farmerId },
      grant: null,
    });

    await expect(updateAd(ownerAccount, 'ad-1', { farmerProfileId: 'other-farm' }))
      .rejects.toMatchObject({ code: 'FARM_SCOPE_IMMUTABLE' });
    await expect(updateAd(ownerAccount, 'ad-1', { animalId: 'other-animal' }))
      .rejects.toMatchObject({ code: 'ANIMAL_IMMUTABLE' });
    await expect(updateAd(ownerAccount, 'ad-1', { advertiserAccountId: 'other' }))
      .rejects.toMatchObject({ code: 'ADVERTISER_IMMUTABLE' });
  });


  test('verified farm owner can publish own farm-scoped ad', async () => {
    const save = jest.fn(async function save() { return this; });
    const ad = farmScopedAd({
      advertiserAccountId: ownerAccount._id,
      createdByAccountId: ownerAccount._id,
      save,
    });
    LivestockAdFindById.mockResolvedValue(ad);
    authorizeFarmAccess.mockResolvedValue({
      mode: 'owner',
      farmerProfile: { _id: farmerId, accountId: ownerAccount._id },
      grant: null,
    });
    SellerProfileFindOne.mockResolvedValue({ verificationStatus: 'verified' });

    const result = await updateAd(ownerAccount, 'ad-1', { publish: true });
    expect(result.status).toBe('published');
    expect(SellerProfileFindOne).toHaveBeenCalledWith({ accountId: ownerAccount._id });
  });

  test('verified delegated manager with grant can publish', async () => {
    const save = jest.fn(async function save() { return this; });
    const ad = farmScopedAd({
      advertiserAccountId: managerAccount._id,
      createdByAccountId: managerAccount._id,
      save,
    });
    LivestockAdFindById.mockResolvedValue(ad);
    authorizeFarmAccess
      .mockRejectedValueOnce(new AppError(403, 'FORBIDDEN', 'not owner'))
      .mockResolvedValueOnce({
        mode: 'delegate',
        farmerProfile: { _id: farmerId },
        grant: { permissions: ['marketplace.manage_farmer_ads'] },
      });
    SellerProfileFindOne.mockResolvedValue({ verificationStatus: 'verified' });

    const result = await updateAd(managerAccount, 'ad-1', { publish: true });
    expect(result.status).toBe('published');
    expect(SellerProfileFindOne).toHaveBeenCalledWith({ accountId: managerAccount._id });
  });

  test('unverified manager with grant cannot publish', async () => {
    const save = jest.fn(async function save() { return this; });
    const ad = farmScopedAd({
      advertiserAccountId: managerAccount._id,
      createdByAccountId: managerAccount._id,
      save,
    });
    LivestockAdFindById.mockResolvedValue(ad);
    authorizeFarmAccess
      .mockRejectedValueOnce(new AppError(403, 'FORBIDDEN', 'not owner'))
      .mockResolvedValueOnce({
        mode: 'delegate',
        farmerProfile: { _id: farmerId },
        grant: { permissions: ['marketplace.manage_farmer_ads'] },
      });
    SellerProfileFindOne.mockResolvedValue({ verificationStatus: 'pending' });

    await expect(updateAd(managerAccount, 'ad-1', { publish: true })).rejects.toMatchObject({
      code: 'SELLER_NOT_VERIFIED',
    });
    expect(save).not.toHaveBeenCalled();
  });

  test('verified manager without grant cannot publish farm-scoped ad', async () => {
    const save = jest.fn(async function save() { return this; });
    const ad = farmScopedAd({
      advertiserAccountId: managerAccount._id,
      createdByAccountId: managerAccount._id,
      save,
    });
    LivestockAdFindById.mockResolvedValue(ad);
    authorizeFarmAccess
      .mockRejectedValueOnce(new AppError(403, 'FORBIDDEN', 'not owner'))
      .mockRejectedValueOnce(new AppError(403, 'FORBIDDEN', 'Missing delegated permission'));
    SellerProfileFindOne.mockResolvedValue({ verificationStatus: 'verified' });

    await expect(updateAd(managerAccount, 'ad-1', { publish: true })).rejects.toMatchObject({
      status: 403,
    });
    expect(save).not.toHaveBeenCalled();
  });

  test('revoked grant denies publish even if manager is verified', async () => {
    const save = jest.fn(async function save() { return this; });
    const ad = farmScopedAd({
      advertiserAccountId: managerAccount._id,
      createdByAccountId: managerAccount._id,
      save,
    });
    LivestockAdFindById.mockResolvedValue(ad);
    authorizeFarmAccess
      .mockRejectedValueOnce(new AppError(403, 'FORBIDDEN', 'not owner'))
      .mockRejectedValueOnce(new AppError(403, 'FORBIDDEN', 'grant revoked'));
    SellerProfileFindOne.mockResolvedValue({ verificationStatus: 'verified' });

    await expect(updateAd(managerAccount, 'ad-1', { publish: true })).rejects.toMatchObject({
      status: 403,
    });
  });

  test('verified actor cannot publish when animal belongs to a different farmer', async () => {
    authorizeFarmAccess.mockResolvedValue({
      mode: 'owner',
      farmerProfile: { _id: farmerId, accountId: ownerAccount._id },
      grant: null,
    });
    assertAnimalInFarm.mockRejectedValue(
      new AppError(403, 'ANIMAL_SCOPE_MISMATCH', 'Animal does not belong to this farm'),
    );
    SellerProfileFindOne.mockResolvedValue({ verificationStatus: 'verified' });

    await expect(createAd(ownerAccount, {
      title: 'Cow',
      species: 'cow',
      price: 1000,
      farmerProfileId: farmerId,
      animalId: 'other-farm-animal',
      publish: true,
    }, [{ url: 'https://x', publicId: 'p1' }])).rejects.toMatchObject({
      code: 'ANIMAL_SCOPE_MISMATCH',
    });
  });

  test('public DTO does not leak ownership or creator ids', () => {
    const ad = farmScopedAd({
      advertiserAccountId: 'adv-secret',
      createdByAccountId: 'creator-secret',
      farmerProfileId: 'farm-secret',
      animalId: 'animal-secret',
    });
    const pub = toPublicAdDto(ad);
    expect(pub).not.toHaveProperty('advertiserAccountId');
    expect(pub).not.toHaveProperty('createdByAccountId');
    expect(pub).not.toHaveProperty('farmerProfileId');
    expect(pub).not.toHaveProperty('animalId');
    const owner = toOwnerAdDto(ad);
    expect(owner.advertiserAccountId).toBe('adv-secret');
    expect(owner.createdByAccountId).toBe('creator-secret');
  });
});
