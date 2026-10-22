import { jest } from '@jest/globals';
import { csrfProtection } from '../../src/shared/middleware/csrf.js';

function responseStub() {
  const res = {
    statusCode: undefined,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  return res;
}

describe('identity CSRF boundary', () => {
  test('rejects a mismatched double-submit token', () => {
    const req = {
      method: 'POST',
      path: '/logout',
      cookies: { 'csrf-token': 'cookie-token' },
      headers: { 'x-csrf-token': 'different-token' },
    };
    const res = responseStub();
    const next = jest.fn();

    csrfProtection(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('allows a matching double-submit token', () => {
    const req = {
      method: 'POST',
      path: '/logout',
      cookies: { 'csrf-token': 'same-token' },
      headers: { 'x-csrf-token': 'same-token' },
    };
    const res = responseStub();
    const next = jest.fn();

    csrfProtection(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeUndefined();
  });
});
