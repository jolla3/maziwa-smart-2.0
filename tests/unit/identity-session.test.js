import { jest } from '@jest/globals';

const testAccount = {
  _id: 'account-test-id',
  sessionVersion: 3,
  role: 'buyer',
  email: 'buyer@example.com',
  username: 'Buyer',
  isActive: true,
};

jest.unstable_mockModule('../../src/modules/identity/service.js', () => ({
  authenticatePassword: jest.fn(async () => testAccount),
  completePasswordSetup: jest.fn(),
  getProfile: jest.fn(),
  needsPasswordSetup: jest.fn(),
  publicAccount: jest.fn((account) => ({ id: String(account._id), role: account.role })),
  registerBuyer: jest.fn(),
  registerFarmer: jest.fn(),
  registerSeller: jest.fn(),
  requestPasswordReset: jest.fn(),
  resetPassword: jest.fn(),
  updateProfile: jest.fn(),
}));

const service = await import('../../src/modules/identity/service.js');
const controller = await import('../../src/modules/identity/controller.js');

function fakeSession() {
  return {
    regenerate: jest.fn((callback) => callback(null)),
    save: jest.fn((callback) => callback(null)),
    destroy: jest.fn((callback) => callback(null)),
  };
}

function fakeResponse() {
  const res = {
    status: jest.fn(() => res),
    json: jest.fn(() => res),
    clearCookie: jest.fn(() => res),
    redirect: jest.fn(() => res),
  };
  return res;
}

describe('identity session controller', () => {
  beforeEach(() => jest.clearAllMocks());

  test('login regenerates the session and returns a user, not a bearer token', async () => {
    const req = {
      body: { email: 'buyer@example.com', password: 'secret123' },
      session: fakeSession(),
    };
    const res = fakeResponse();

    await controller.login(req, res);

    expect(service.authenticatePassword).toHaveBeenCalledWith('buyer@example.com', 'secret123');
    expect(req.session.regenerate).toHaveBeenCalledTimes(1);
    expect(req.session.userId).toBe('account-test-id');
    expect(req.session.sessionVersion).toBe(3);
    expect(req.session.save).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ success: true, user: { id: 'account-test-id', role: 'buyer' } });
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('token');
  });

  test('logout destroys the server-side session and clears the session cookie', async () => {
    const req = { session: fakeSession() };
    const res = fakeResponse();

    await controller.logout(req, res);

    expect(req.session.destroy).toHaveBeenCalledTimes(1);
    expect(res.clearCookie).toHaveBeenCalledWith('connect.sid', expect.objectContaining({ path: '/', httpOnly: true }));
    expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Logged out successfully.' });
  });
});
