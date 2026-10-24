import { jest } from '@jest/globals';
import { AppError } from '../../src/shared/errors/AppError.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const getActiveAccountRef = jest.fn();
const findOwnedFarmerProfile = jest.fn();
const getActiveFarmerProfileById = jest.fn();
const GrantFindOne = jest.fn();
const GrantFindById = jest.fn();
const GrantCreate = jest.fn();
const GrantFind = jest.fn();

jest.unstable_mockModule('../../src/modules/identity/service.js', () => ({
  getActiveAccountRef,
  publicAccount: jest.fn(),
}));
jest.unstable_mockModule('../../src/modules/farmers/service.js', () => ({
  findOwnedFarmerProfile,
  getActiveFarmerProfileById,
  publicFarmer: jest.fn(),
}));
jest.unstable_mockModule('../../src/modules/farm-access/model.js', () => ({
  FarmAccessGrant: {
    findOne: GrantFindOne,
    findById: GrantFindById,
    create: GrantCreate,
    find: GrantFind,
  },
}));

const {
  authorizeFarmAccess,
  grantAccess,
  revokeAccess,
  findOwnedFarmerProfile: reexportedFindOwned,
} = await import('../../src/modules/farm-access/service.js');

const owner = { _id: 'owner-1' };
const recipient = { _id: 'rec-1', id: 'rec-1', email: 'r@x.com', role: 'user', isActive: true };
const farmer = { _id: 'farm-1', accountId: 'owner-1', isActive: true };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('farm-access uses public identity/farmers interfaces', () => {
  test('grantAccess validates recipient via identity.getActiveAccountRef', async () => {
    findOwnedFarmerProfile.mockResolvedValue(farmer);
    getActiveAccountRef.mockResolvedValue(recipient);
    GrantFindOne.mockResolvedValue(null);
    GrantCreate.mockImplementation(async (doc) => ({ ...doc, _id: 'g1', save: jest.fn() }));

    await grantAccess(owner, {
      recipientAccountId: 'rec-1',
      permissions: ['animals.read'],
    });

    expect(getActiveAccountRef).toHaveBeenCalledWith('rec-1');
    expect(GrantCreate).toHaveBeenCalledWith(expect.objectContaining({
      recipientAccountId: recipient._id,
      farmerProfileId: farmer._id,
      permissions: ['animals.read'],
    }));
  });

  test('grantAccess denies missing recipient without touching Account model', async () => {
    findOwnedFarmerProfile.mockResolvedValue(farmer);
    getActiveAccountRef.mockResolvedValue(null);
    await expect(grantAccess(owner, {
      recipientAccountId: 'missing',
      permissions: ['animals.read'],
    })).rejects.toMatchObject({ code: 'RECIPIENT_NOT_FOUND' });
    expect(GrantCreate).not.toHaveBeenCalled();
  });

  test('authorizeFarmAccess owner path uses farmers.getActiveFarmerProfileById', async () => {
    getActiveFarmerProfileById.mockResolvedValue(farmer);
    const result = await authorizeFarmAccess(owner, 'farm-1', null);
    expect(result.mode).toBe('owner');
    expect(getActiveFarmerProfileById).toHaveBeenCalledWith('farm-1');
  });

  test('authorizeFarmAccess denies missing grant for delegate', async () => {
    getActiveFarmerProfileById.mockResolvedValue(farmer);
    GrantFindOne.mockResolvedValue(null);
    await expect(authorizeFarmAccess({ _id: 'mgr-1' }, 'farm-1', 'animals.read'))
      .rejects.toMatchObject({ status: 403 });
  });

  test('authorizeFarmAccess denies insufficient permission', async () => {
    getActiveFarmerProfileById.mockResolvedValue(farmer);
    GrantFindOne.mockResolvedValue({
      permissions: ['animals.read'],
      status: 'active',
      expiresAt: null,
    });
    await expect(authorizeFarmAccess({ _id: 'mgr-1' }, 'farm-1', 'finance.read'))
      .rejects.toMatchObject({ status: 403 });
  });

  test('authorizeFarmAccess denies expired grant', async () => {
    getActiveFarmerProfileById.mockResolvedValue(farmer);
    GrantFindOne.mockResolvedValue({
      permissions: ['animals.read'],
      status: 'active',
      expiresAt: new Date(Date.now() - 60_000),
    });
    await expect(authorizeFarmAccess({ _id: 'mgr-1' }, 'farm-1', 'animals.read'))
      .rejects.toMatchObject({ status: 403 });
  });

  test('revokeAccess requires owner profile via farmers lookup', async () => {
    findOwnedFarmerProfile.mockResolvedValue(null);
    await expect(revokeAccess(owner, 'g1')).rejects.toMatchObject({ code: 'FARMER_PROFILE_REQUIRED' });
  });

  test('findOwnedFarmerProfile is re-exported from farmers service', async () => {
    findOwnedFarmerProfile.mockResolvedValue(farmer);
    const got = await reexportedFindOwned('owner-1');
    expect(got).toBe(farmer);
    expect(findOwnedFarmerProfile).toHaveBeenCalledWith('owner-1');
  });
});

describe('architecture boundary: farm-access must not import private sibling models', () => {
  test('farm-access/service.js has no identity/farmers model imports', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const src = fs.readFileSync(path.join(root, 'src/modules/farm-access/service.js'), 'utf8');
    expect(src).not.toMatch(/from ['"]\.\.\/identity\/model\.js['"]/);
    expect(src).not.toMatch(/from ['"]\.\.\/farmers\/model\.js['"]/);
    expect(src).toMatch(/from ['"]\.\.\/identity\/service\.js['"]/);
    expect(src).toMatch(/from ['"]\.\.\/farmers\/service\.js['"]/);
  });
});
