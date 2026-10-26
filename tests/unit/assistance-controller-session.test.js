import { describe, test, expect, jest, beforeEach } from '@jest/globals';

const getAccountForSession = jest.fn();

jest.unstable_mockModule('../../src/modules/identity/service.js', () => ({
  getAccountForSession: (...args) => getAccountForSession(...args),
}));

const { resolveOptionalSessionAccount, postMessage } = await import(
  '../../src/modules/assistance/controller.js'
);
const { apiResponse } = await import('../../src/shared/http/response.js');

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe('assistance optional session resolution', () => {
  beforeEach(() => {
    getAccountForSession.mockReset();
  });

  test('missing session userId → null without lookup', async () => {
    const req = { session: {} };
    const account = await resolveOptionalSessionAccount(req);
    expect(account).toBeNull();
    expect(getAccountForSession).not.toHaveBeenCalled();
  });

  test('inactive account → null (anonymous)', async () => {
    getAccountForSession.mockResolvedValue({ isActive: false, sessionVersion: 1 });
    const req = { session: { userId: 'abc', sessionVersion: 1 } };
    const account = await resolveOptionalSessionAccount(req);
    expect(account).toBeNull();
  });

  test('sessionVersion mismatch → null', async () => {
    getAccountForSession.mockResolvedValue({ isActive: true, sessionVersion: 2 });
    const req = { session: { userId: 'abc', sessionVersion: 1 } };
    const account = await resolveOptionalSessionAccount(req);
    expect(account).toBeNull();
  });

  test('verified active matching session → { verified: true }', async () => {
    getAccountForSession.mockResolvedValue({ isActive: true, sessionVersion: 3 });
    const req = { session: { userId: 'abc', sessionVersion: 3 } };
    const account = await resolveOptionalSessionAccount(req);
    expect(account).toEqual({ verified: true });
  });

  test('getAccountForSession throw → postMessage returns 500 ASSISTANCE_INTERNAL_ERROR', async () => {
    getAccountForSession.mockRejectedValue(new Error('mongo exploded'));
    const req = {
      session: { userId: 'abc', sessionVersion: 1 },
      body: { message: 'show my animals' },
    };
    const res = mockRes();
    const next = jest.fn();
    await postMessage(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('ASSISTANCE_INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/mongo exploded|stack/i);
  });
});
