/**
 * Assistance core service — deterministic match + outcome selection (G1.1)
 * No HTTP, no domain imports, no identity lookup (G1.2 passes sessionAccount).
 */

import {
  INTENTS,
  KINDS,
  KIND_PRECEDENCE,
  OUTCOMES,
  GENERIC_CLARIFY_OPTIONS,
  getContent,
  resolveActions,
} from './catalog.js';
import { validateAssistanceBody, normalizeForMatch } from './validation.js';

/**
 * @param {string[]} words
 * @param {string[]} phraseWords
 */
function wordsContainPhrase(words, phraseWords) {
  if (!phraseWords.length || phraseWords.length > words.length) return false;
  for (let i = 0; i <= words.length - phraseWords.length; i += 1) {
    let ok = true;
    for (let j = 0; j < phraseWords.length; j += 1) {
      if (words[i + j] !== phraseWords[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Token groups: AND across groups; OR within group alternatives.
 * @param {string[]} words
 * @param {string[][][]} tokenGroups
 */
function matchesTokenGroups(words, tokenGroups) {
  if (!tokenGroups || !tokenGroups.length) return false;
  return tokenGroups.every((group) =>
    group.some((phraseWords) => wordsContainPhrase(words, phraseWords)),
  );
}

function intentHits(normalized, intent) {
  if (intent.aliases?.includes(normalized)) return true;
  if (intent.tokenGroups?.length) {
    const words = normalized.split(' ').filter(Boolean);
    if (matchesTokenGroups(words, intent.tokenGroups)) return true;
  }
  return false;
}

/**
 * Deduplicate by intent id; keep single entry per intent.
 * @returns {typeof INTENTS[number][]}
 */
export function matchIntents(normalizedMessage) {
  const hits = [];
  const seen = new Set();
  for (const intent of INTENTS) {
    if (intentHits(normalizedMessage, intent) && !seen.has(intent.id)) {
      seen.add(intent.id);
      hits.push(intent);
    }
  }
  return hits;
}

function sortByPrecedence(hits) {
  return [...hits].sort((a, b) => {
    const pa = KIND_PRECEDENCE[a.kind] ?? 99;
    const pb = KIND_PRECEDENCE[b.kind] ?? 99;
    if (pa !== pb) return pa - pb;
    return (a.order ?? 100) - (b.order ?? 100);
  });
}

function emptyResult(partial) {
  return {
    outcome: partial.outcome,
    answerText: partial.answerText ?? null,
    actions: partial.actions ?? [],
    clarifyOptions: partial.clarifyOptions ?? [],
    missingInputs: partial.missingInputs ?? [],
    intentId: partial.intentId ?? null,
    contentId: partial.contentId ?? null,
  };
}

function buildFromIntent(intent, { sessionAccount = null } = {}) {
  if (intent.kind === KINDS.PROHIBITED_WRITE) {
    const contentId = intent.contentId;
    return emptyResult({
      outcome: OUTCOMES.FORBIDDEN,
      answerText: getContent(contentId),
      actions: resolveActions(intent.actionIds),
      intentId: intent.id,
      contentId,
    });
  }

  if (intent.kind === KINDS.PRIVATE_INFO) {
    const verified = Boolean(sessionAccount && sessionAccount.verified);
    if (!verified) {
      const contentId = intent.contentIdAuth;
      return emptyResult({
        outcome: OUTCOMES.AUTH_REQUIRED,
        answerText: getContent(contentId),
        actions: resolveActions(intent.actionIdsAuth),
        intentId: intent.id,
        contentId,
      });
    }
    const contentId = intent.contentIdDisabled;
    return emptyResult({
      outcome: OUTCOMES.DISABLED_IN_MVP,
      answerText: getContent(contentId),
      actions: resolveActions(intent.actionIdsDisabled),
      intentId: intent.id,
      contentId,
    });
  }

  // public_help
  if (intent.needInput) {
    const contentId = intent.contentId;
    return emptyResult({
      outcome: OUTCOMES.NEED_INPUT,
      answerText: getContent(contentId),
      actions: resolveActions(intent.actionIds),
      missingInputs: [{ field: intent.needInput.field, prompt: intent.needInput.prompt }],
      intentId: intent.id,
      contentId,
    });
  }

  const contentId = intent.contentId;
  return emptyResult({
    outcome: OUTCOMES.ANSWERED,
    answerText: getContent(contentId),
    actions: resolveActions(intent.actionIds),
    intentId: intent.id,
    contentId,
  });
}

function unsupportedResult() {
  const contentId = 'content.unsupported.v1';
  return emptyResult({
    outcome: OUTCOMES.UNSUPPORTED,
    answerText: getContent(contentId),
    contentId,
  });
}

function clarifyResult() {
  const contentId = 'content.clarify_topics.v1';
  return emptyResult({
    outcome: OUTCOMES.CLARIFY_AMBIGUOUS,
    answerText: getContent(contentId),
    clarifyOptions: GENERIC_CLARIFY_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
    contentId,
  });
}

/**
 * Resolve which single intent (or clarify/unsupported) from hits.
 */
export function resolveHit(hits) {
  if (!hits.length) return { type: 'unsupported' };
  const sorted = sortByPrecedence(hits);
  const best = sorted[0];
  const bestRank = KIND_PRECEDENCE[best.kind] ?? 99;

  // Other hits at strictly worse precedence are discarded.
  const sameBand = sorted.filter((h) => (KIND_PRECEDENCE[h.kind] ?? 99) === bestRank);

  if (sameBand.length === 1) return { type: 'intent', intent: sameBand[0] };

  // Same kind band, multiple intents: if all same id (shouldn't happen) take one;
  // otherwise clarify when they are distinct public_help; for write/private prefer best.order only if different kinds already handled.
  const uniqueIds = new Set(sameBand.map((h) => h.id));
  if (uniqueIds.size === 1) return { type: 'intent', intent: sameBand[0] };

  // Prefer more specific (lower order) when same kind and one is clearly more specific?
  // Catalogue: same precedence conflict → clarify_ambiguous with generic topics.
  // Exception: prohibited_write / private_info should not clarify across different write intents —
  // take the best (lowest order) single prohibited/private hit to avoid soft-deny ambiguity.
  if (best.kind === KINDS.PROHIBITED_WRITE || best.kind === KINDS.PRIVATE_INFO) {
    return { type: 'intent', intent: best };
  }

  return { type: 'clarify' };
}

/**
 * Process a validated message string with optional session context.
 * @param {string} message trimmed non-empty message
 * @param {{ sessionAccount?: null | { verified: boolean } }} [context]
 */
export function processMessage(message, context = {}) {
  const normalized = normalizeForMatch(message);
  const hits = matchIntents(normalized);
  const resolution = resolveHit(hits);

  if (resolution.type === 'unsupported') return unsupportedResult();
  if (resolution.type === 'clarify') return clarifyResult();
  return buildFromIntent(resolution.intent, {
    sessionAccount: context.sessionAccount ?? null,
  });
}

/**
 * Full entry used by tests and (later) controller: validate body then process.
 * @param {unknown} body
 * @param {{ sessionAccount?: null | { verified: boolean } }} [context]
 * @returns {{ ok: true, data: object } | { ok: false, error: object }}
 */
export function handleAssistanceRequest(body, context = {}) {
  const validated = validateAssistanceBody(body);
  if (!validated.ok) {
    return {
      ok: false,
      error: {
        code: validated.code,
        message: validated.message,
        details: { fields: validated.fields },
      },
    };
  }
  const data = processMessage(validated.message, context);
  return { ok: true, data };
}

export { validateAssistanceBody, normalizeForMatch, OUTCOMES, KINDS };
