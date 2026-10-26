import { describe, test, expect } from '@jest/globals';
import { matchIntents, processMessage, resolveHit } from '../../src/modules/assistance/service.js';
import { normalizeForMatch } from '../../src/modules/assistance/validation.js';
import { INTENTS } from '../../src/modules/assistance/catalog.js';

function outcomeFor(message, ctx) {
  return processMessage(message, ctx);
}

describe('assistance matcher — positive fixtures per intent', () => {
  const positives = [
    ['what is maziwasmart', 'help.product_overview', 'answered'],
    ['help', 'help.what_can_you_do', 'answered'],
    ['how do i sign in', 'help.sign_in', 'answered'],
    ['forgot password', 'help.account_recovery', 'answered'],
    ['how do i register', 'help.registration_menu', 'need_input'],
    ['farmer', 'help.register_farmer', 'answered'],
    ['register as farmer', 'help.register_farmer', 'answered'],
    ['seller', 'help.register_seller', 'answered'],
    ['buyer', 'help.register_buyer', 'answered'],
    ["why can't i publish", 'help.seller_verification', 'answered'],
    ['how do i publish', 'help.seller_verification', 'answered'],
    ['how do i add an animal', 'help.animals', 'answered'],
    ['how do i record milk', 'help.milk_yield', 'answered'],
    ['farm records', 'help.farm_records_bundle', 'answered'],
    ['manager permissions', 'help.farm_access', 'answered'],
    ['browse livestock', 'help.marketplace_public', 'answered'],
    ['marketplace', 'help.marketplace_public', 'answered'],
    ['how do i list an animal for sale', 'help.seller_listings', 'answered'],
    ['contact seller', 'help.human_messaging', 'answered'],
    ['show my animals', 'private_info.my_animals', 'auth_required'],
    ['show my milk records', 'private_info.my_milk', 'auth_required'],
    ['publish my ad now', 'prohibited_write.publish_ad', 'forbidden'],
    ['delete my animal', 'prohibited_write.mutate_animal', 'forbidden'],
    ['verify my seller account', 'prohibited_write.verify_seller', 'forbidden'],
    ['record this income', 'prohibited_write.finance', 'forbidden'],
    ['send a message to the seller', 'prohibited_write.send_message', 'forbidden'],
    ['wire me money', null, 'unsupported'],
  ];

  test.each(positives)('%s → %s / %s', (message, intentId, outcome) => {
    const r = outcomeFor(message);
    expect(r.outcome).toBe(outcome);
    if (intentId) expect(r.intentId).toBe(intentId);
    else expect(r.intentId).toBeNull();
  });
});

describe('assistance matcher — token groups and whole words', () => {
  test('AND across groups: register as farmer', () => {
    expect(outcomeFor('register as farmer').intentId).toBe('help.register_farmer');
  });

  test('OR within group: farmer registration', () => {
    expect(outcomeFor('farmer registration').intentId).toBe('help.register_farmer');
  });

  test('multi-word phrase sign up + farmer', () => {
    expect(outcomeFor('sign up farmer').intentId).toBe('help.register_farmer');
  });

  test('whole-word: farmers alone does not token-match farmer registration', () => {
    const hits = matchIntents(normalizeForMatch('farmers'));
    expect(hits.some((h) => h.id === 'help.register_farmer')).toBe(false);
  });

  test('marketplace token group: public listings', () => {
    expect(outcomeFor('public listings').intentId).toBe('help.marketplace_public');
  });
});

describe('assistance matcher — precedence help vs write', () => {
  test('how do i publish is guidance not forbidden', () => {
    const r = outcomeFor('how do i publish');
    expect(r.intentId).toBe('help.seller_verification');
    expect(r.outcome).toBe('answered');
  });

  test('publish my ad now is forbidden', () => {
    const r = outcomeFor('publish my ad now');
    expect(r.intentId).toBe('prohibited_write.publish_ad');
    expect(r.outcome).toBe('forbidden');
  });

  test('how do i record milk is help', () => {
    expect(outcomeFor('how do i record milk').intentId).toBe('help.milk_yield');
  });

  test('record this income is forbidden finance write', () => {
    const r = outcomeFor('record this income');
    expect(r.intentId).toBe('prohibited_write.finance');
    expect(r.outcome).toBe('forbidden');
  });
});

describe('assistance matcher — stateless follow-ups', () => {
  test('registration need_input then farmer/seller/buyer', () => {
    const step1 = outcomeFor('how do i register');
    expect(step1.outcome).toBe('need_input');
    expect(step1.missingInputs[0].field).toBe('role');

    expect(outcomeFor('farmer').intentId).toBe('help.register_farmer');
    expect(outcomeFor('seller').intentId).toBe('help.register_seller');
    expect(outcomeFor('buyer').intentId).toBe('help.register_buyer');
  });

  test('clarify labels as standalone messages', () => {
    expect(outcomeFor('registration').intentId).toBe('help.registration_menu');
    expect(outcomeFor('marketplace').intentId).toBe('help.marketplace_public');
    expect(outcomeFor('farm records').intentId).toBe('help.farm_records_bundle');
  });
});

describe('assistance matcher — normalization edge cases', () => {
  test('mixed case and punctuation still match', () => {
    expect(outcomeFor('HELP?').intentId).toBe('help.what_can_you_do');
    expect(outcomeFor('What Is MaziwaSmart!').intentId).toBe('help.product_overview');
  });

  test('alias and token for same intent count as one hit', () => {
    const hits = matchIntents(normalizeForMatch('register as farmer'));
    const farmerHits = hits.filter((h) => h.id === 'help.register_farmer');
    expect(farmerHits).toHaveLength(1);
  });
});

describe('assistance matcher — catalogue completeness', () => {
  test('every intent has at least one alias', () => {
    for (const intent of INTENTS) {
      expect(intent.aliases?.length).toBeGreaterThan(0);
    }
  });
});

describe('resolveHit', () => {
  test('empty hits → unsupported', () => {
    expect(resolveHit([]).type).toBe('unsupported');
  });
});
