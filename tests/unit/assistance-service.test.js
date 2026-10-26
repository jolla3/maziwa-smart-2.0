import { describe, test, expect } from '@jest/globals';
import { handleAssistanceRequest, processMessage, OUTCOMES } from '../../src/modules/assistance/service.js';
import { ACTIONS, resolveActions } from '../../src/modules/assistance/catalog.js';

describe('assistance service outcomes', () => {
  test('public help returns answered with catalogue content', () => {
    const r = handleAssistanceRequest({ message: 'what is maziwasmart' });
    expect(r.ok).toBe(true);
    expect(r.data.outcome).toBe(OUTCOMES.ANSWERED);
    expect(r.data.answerText).toMatch(/MaziwaSmart/);
    expect(r.data.contentId).toBe('content.product_overview.v1');
    expect(r.data.actions).toEqual([]);
    expect(r.data.clarifyOptions).toEqual([]);
    expect(r.data.missingInputs).toEqual([]);
  });

  test('public help does not require sessionAccount', () => {
    const r = processMessage('help', {});
    expect(r.outcome).toBe('answered');
  });

  test('anonymous private_info → auth_required with sign-in action', () => {
    const r = processMessage('show my animals', { sessionAccount: null });
    expect(r.outcome).toBe('auth_required');
    expect(r.intentId).toBe('private_info.my_animals');
    expect(r.actions.map((a) => a.id)).toContain('nav.sign_in');
    expect(r.answerText).toMatch(/private/i);
  });

  test('verified session private_info → disabled_in_mvp', () => {
    const r = processMessage('show my animals', {
      sessionAccount: { verified: true },
    });
    expect(r.outcome).toBe('disabled_in_mvp');
    expect(r.intentId).toBe('private_info.my_animals');
  });

  test('stale/unverified session object treated as anonymous for private_info', () => {
    const r = processMessage('show my milk records', {
      sessionAccount: { verified: false },
    });
    expect(r.outcome).toBe('auth_required');
  });

  test('prohibited write → forbidden and does not claim success', () => {
    const r = processMessage('publish my ad now');
    expect(r.outcome).toBe('forbidden');
    expect(r.answerText).not.toMatch(/published successfully/i);
    expect(r.answerText).toMatch(/cannot publish/i);
  });

  test('unsupported has no intent', () => {
    const r = processMessage('teleport my cows to the moon');
    expect(r.outcome).toBe('unsupported');
    expect(r.intentId).toBeNull();
  });

  test('actions only use allowlisted ids', () => {
    const r = processMessage('browse livestock');
    for (const a of r.actions) {
      expect(ACTIONS[a.id]).toBeDefined();
      expect(a.label).toBe(ACTIONS[a.id].label);
    }
  });

  test('resolveActions drops unknown ids', () => {
    expect(resolveActions(['nav.sign_in', 'nav.evil', 'https://evil.test'])).toEqual([
      { id: 'nav.sign_in', label: 'Sign in' },
    ]);
  });

  test('user URL in message is not turned into an action', () => {
    const r = processMessage('go to https://evil.example/phish');
    expect(r.actions.every((a) => !String(a.id).includes('http'))).toBe(true);
    expect(r.outcome).toBe('unsupported');
  });

  test('validation failure shape', () => {
    const r = handleAssistanceRequest({ message: '' });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('VALIDATION_ERROR');
  });

  test('response fields always present on success', () => {
    const r = handleAssistanceRequest({ message: 'contact seller' });
    expect(r.ok).toBe(true);
    const d = r.data;
    expect(d).toHaveProperty('outcome');
    expect(d).toHaveProperty('answerText');
    expect(d).toHaveProperty('actions');
    expect(d).toHaveProperty('clarifyOptions');
    expect(d).toHaveProperty('missingInputs');
    expect(d).toHaveProperty('intentId');
    expect(d).toHaveProperty('contentId');
  });

  test('service module does not export domain side effects API', async () => {
    const mod = await import('../../src/modules/assistance/service.js');
    expect(mod.createAnimal).toBeUndefined();
    expect(mod.publishAd).toBeUndefined();
    expect(mod.sendMessage).toBeUndefined();
  });
});
