import { describe, test, expect } from '@jest/globals';
import {
  validateAssistanceBody,
  normalizeForMatch,
  MAX_MESSAGE_LENGTH,
} from '../../src/modules/assistance/validation.js';
import { handleAssistanceRequest } from '../../src/modules/assistance/service.js';

describe('assistance validation', () => {
  test('rejects missing message', () => {
    const r = validateAssistanceBody({});
    expect(r.ok).toBe(false);
    expect(r.code).toBe('VALIDATION_ERROR');
  });

  test('rejects non-string message', () => {
    expect(validateAssistanceBody({ message: 1 }).ok).toBe(false);
    expect(validateAssistanceBody({ message: null }).ok).toBe(false);
  });

  test('rejects empty and whitespace-only message', () => {
    expect(validateAssistanceBody({ message: '' }).ok).toBe(false);
    expect(validateAssistanceBody({ message: '   ' }).ok).toBe(false);
  });

  test('accepts message at exactly 2000 code units', () => {
    const message = 'a'.repeat(MAX_MESSAGE_LENGTH);
    const r = validateAssistanceBody({ message });
    expect(r.ok).toBe(true);
    expect(r.message).toHaveLength(2000);
  });

  test('rejects message over 2000 code units', () => {
    const message = 'a'.repeat(MAX_MESSAGE_LENGTH + 1);
    expect(validateAssistanceBody({ message }).ok).toBe(false);
  });

  test('trims leading and trailing whitespace', () => {
    const r = validateAssistanceBody({ message: '  help  ' });
    expect(r.ok).toBe(true);
    expect(r.message).toBe('help');
  });

  test('normalizeForMatch lowercases, collapses spaces, strips trailing punctuation', () => {
    expect(normalizeForMatch('  What   Is   MaziwaSmart?  ')).toBe('what is maziwasmart');
    expect(normalizeForMatch('Help!')).toBe('help');
    expect(normalizeForMatch('browse livestock.')).toBe('browse livestock');
  });

  test('extra body properties do not affect matching or authorization', () => {
    const r = handleAssistanceRequest({
      message: 'help',
      role: 'admin',
      accountId: 'fake',
      userId: 'x',
      permissions: ['*'],
    });
    expect(r.ok).toBe(true);
    expect(r.data.outcome).toBe('answered');
    expect(r.data.intentId).toBe('help.what_can_you_do');
  });
});
