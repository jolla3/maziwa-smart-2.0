import { jest } from '@jest/globals';

const AccountFindById = jest.fn();

jest.unstable_mockModule('../../src/modules/identity/model.js', () => ({
  Account: {
    findById: AccountFindById,
    findOne: jest.fn(),
    exists: jest.fn(),
    create: jest.fn(),
    deleteOne: jest.fn(),
  },
}));
jest.unstable_mockModule('../../src/modules/farmers/service.js', () => ({
  createFarmerProfileForAccount: jest.fn(),
  getFarmerProfileForAccount: jest.fn(),
  updateFarmerProfileForAccount: jest.fn(),
  isFarmerPhoneTaken: jest.fn(),
  allocateFarmerCode: jest.fn(),
  findOwnedFarmerProfile: jest.fn(),
  getActiveFarmerProfileById: jest.fn(),
}));
jest.unstable_mockModule('../../src/modules/sellers/service.js', () => ({
  createPendingSellerProfile: jest.fn(),
  getSellerProfileForAccount: jest.fn(),
  ensureSellerProfile: jest.fn(),
  assertVerifiedForPublish: jest.fn(),
  isVerifiedSeller: jest.fn(),
}));
jest.unstable_mockModule('../../src/modules/identity/emailService.js', () => ({
  sendPasswordResetEmail: jest.fn(),
  sendWelcomeEmail: jest.fn(async () => {}),
}));

const { getAccountForSession, getActiveAccountRef } = await import('../../src/modules/identity/service.js');

describe('identity session hydration API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('getAccountForSession returns null for missing account', async () => {
    AccountFindById.mockReturnValue({
      select: jest.fn().mockResolvedValue(null),
    });
    await expect(getAccountForSession('missing')).resolves.toBeNull();
  });

  test('getAccountForSession selects without password fields', async () => {
    const account = {
      _id: 'a1',
      email: 'a@x.com',
      role: 'farmer',
      isActive: true,
      sessionVersion: 2,
    };
    const select = jest.fn().mockResolvedValue(account);
    AccountFindById.mockReturnValue({ select });
    const got = await getAccountForSession('a1');
    expect(got).toBe(account);
    expect(select).toHaveBeenCalledWith(
      expect.stringMatching(/sessionVersion/),
    );
    expect(select.mock.calls[0][0]).not.toMatch(/passwordHash/);
    expect(select.mock.calls[0][0]).not.toMatch(/resetPassword/);
  });

  test('getActiveAccountRef rejects inactive accounts', async () => {
    AccountFindById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: 'a1', isActive: false, email: 'x', role: 'buyer' }),
    });
    await expect(getActiveAccountRef('a1')).resolves.toBeNull();
  });
});
