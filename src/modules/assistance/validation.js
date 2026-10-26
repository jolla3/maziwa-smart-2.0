/**
 * Assistance request validation (G0.2.1 / G1.1)
 * Only `message` is accepted for behavior. Extra properties are ignored by the service.
 */

export const MAX_MESSAGE_LENGTH = 2000;

/**
 * @param {unknown} body
 * @returns {{ ok: true, message: string } | { ok: false, code: string, message: string, fields: string[] }}
 */
export function validateAssistanceBody(body) {
  if (body === null || body === undefined || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'Request body must be a JSON object with a message string',
      fields: ['message'],
    };
  }

  const raw = body.message;
  if (typeof raw !== 'string') {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'message is required and must be a non-empty string at most 2000 characters',
      fields: ['message'],
    };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'message is required and must be a non-empty string at most 2000 characters',
      fields: ['message'],
    };
  }

  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'message is required and must be a non-empty string at most 2000 characters',
      fields: ['message'],
    };
  }

  return { ok: true, message: trimmed };
}

/**
 * Normalize for matching only (does not change catalogue answer casing).
 * @param {string} message already trimmed validated message
 */
export function normalizeForMatch(message) {
  let s = String(message).trim();
  s = s.replace(/\s+/g, ' ');
  s = s.toLowerCase();
  if (/[?!.]$/.test(s)) {
    s = s.slice(0, -1).trimEnd();
  }
  return s;
}
