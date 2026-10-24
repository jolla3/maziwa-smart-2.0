import { jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const createFarmerProfileForAccount = jest.fn();
const createPendingSellerProfile = jest.fn();
const isFarmerPhoneTaken = jest.fn();
const allocateFarmerCode = jest.fn();
const AccountCreate = jest.fn();
const AccountExists = jest.fn();
const AccountDeleteOne = jest.fn();

jest.unstable_mockModule('../../src/modules/identity/model.js', () => ({
  Account: {
    create: AccountCreate,
    exists: AccountExists,
    deleteOne: AccountDeleteOne,
    findOne: jest.fn(),
    findById: jest.fn(),
  },
}));
jest.unstable_mockModule('../../src/modules/farmers/service.js', () => ({
  createFarmerProfileForAccount,
  isFarmerPhoneTaken,
  allocateFarmerCode,
  getFarmerProfileForAccount: jest.fn(),
  updateFarmerProfileForAccount: jest.fn(),
  findOwnedFarmerProfile: jest.fn(),
  getActiveFarmerProfileById: jest.fn(),
}));
jest.unstable_mockModule('../../src/modules/sellers/service.js', () => ({
  createPendingSellerProfile,
  getSellerProfileForAccount: jest.fn(),
  ensureSellerProfile: jest.fn(),
  assertVerifiedForPublish: jest.fn(),
  isVerifiedSeller: jest.fn(),
}));
jest.unstable_mockModule('../../src/modules/identity/emailService.js', () => ({
  sendPasswordResetEmail: jest.fn(),
  sendWelcomeEmail: jest.fn(async () => {}),
}));
jest.unstable_mockModule('bcryptjs', () => ({
  default: { hash: jest.fn(async () => 'hash'), compare: jest.fn() },
}));

const { registerSeller, registerFarmer } = await import('../../src/modules/identity/service.js');

describe('identity registration uses farmers/sellers public APIs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AccountExists.mockResolvedValue(false);
  });

  test('registerSeller creates pending seller via sellers service', async () => {
    AccountCreate.mockResolvedValue({
      _id: 'acc-s',
      username: 'Sam',
      email: 's@x.com',
      role: 'seller',
      onboardingComplete: true,
    });
    createPendingSellerProfile.mockResolvedValue({
      accountId: 'acc-s',
      verificationStatus: 'pending',
    });

    const out = await registerSeller({
      email: 's@x.com',
      password: 'Password1!',
      username: 'Sam',
    });
    expect(createPendingSellerProfile).toHaveBeenCalledWith('acc-s');
    expect(out.verification_status).toBe('pending');
    expect(out.is_approved_seller).toBe(false);
  });

  test('registerFarmer creates farmer profile via farmers service', async () => {
    AccountCreate.mockResolvedValue({
      _id: 'acc-f',
      username: 'Fay',
      email: 'f@x.com',
      role: 'farmer',
      onboardingComplete: true,
    });
    isFarmerPhoneTaken.mockResolvedValue(false);
    allocateFarmerCode.mockResolvedValue(12345678);
    createFarmerProfileForAccount.mockResolvedValue({
      id: 'fp1',
      accountId: 'acc-f',
      farmerCode: 12345678,
    });

    const out = await registerFarmer({
      email: 'f@x.com',
      password: 'Password1!',
      fullname: 'Fay',
      phone: '0700000000',
    });
    expect(isFarmerPhoneTaken).toHaveBeenCalledWith('0700000000');
    expect(createFarmerProfileForAccount).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'acc-f',
      fullName: 'Fay',
      phone: '0700000000',
      farmerCode: 12345678,
    }));
    expect(out.farmer_code).toBe(12345678);
  });

  test('registerFarmer rejects taken phone before account create', async () => {
    isFarmerPhoneTaken.mockResolvedValue(true);
    await expect(registerFarmer({
      email: 'f@x.com',
      password: 'Password1!',
      fullname: 'Fay',
      phone: '0700000000',
    })).rejects.toMatchObject({ code: 'FARMER_PHONE_EXISTS' });
    expect(AccountCreate).not.toHaveBeenCalled();
  });
});

describe('source boundary', () => {
  test('identity service source has no private farmers/sellers model imports', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const src = fs.readFileSync(path.join(root, 'src/modules/identity/service.js'), 'utf8');
    expect(src).not.toMatch(/from ['"]\.\.\/farmers\/model\.js['"]/);
    expect(src).not.toMatch(/from ['"]\.\.\/sellers\/model\.js['"]/);
  });

  test('requireAuth source has no identity model import', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const src = fs.readFileSync(path.join(root, 'src/shared/middleware/requireAuth.js'), 'utf8');
    expect(src).not.toMatch(/identity\/model\.js/);
    expect(src).toMatch(/getAccountForSession/);
  });
});
