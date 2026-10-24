/**
 * Business-date helpers for Africa/Nairobi calendar dates.
 * Date-only fields are stored as UTC Date at 00:00:00.000Z for the YYYY-MM-DD value
 * so the calendar day is unambiguous and not shifted by host timezone.
 * TIME_AND_DATE_RULES.md — do not invent per-farm timezones.
 */
import { AppError } from '../errors/AppError.js';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a business date (YYYY-MM-DD preferred, or ISO instant whose UTC date is used
 * only when a full timestamp is provided with explicit Z/offset).
 * Rejects empty, invalid, and offset-less ambiguous date-times.
 */
export function parseBusinessDate(value, { field = 'date', required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new AppError(400, 'DATE_REQUIRED', `${field} is required`);
    return undefined;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new AppError(400, 'INVALID_DATE', `${field} is invalid`);
    }
    // Normalize to UTC date-only components of the given instant.
    return utcDateOnly(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }

  const s = String(value).trim();
  const m = DATE_ONLY.exec(s);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!isValidYmd(y, mo, d)) {
      throw new AppError(400, 'INVALID_DATE', `${field} is not a valid calendar date`);
    }
    return utcDateOnly(y, mo, d);
  }

  // ISO-8601 with explicit timezone (Z or ±hh:mm)
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const inst = new Date(s);
    if (Number.isNaN(inst.getTime())) {
      throw new AppError(400, 'INVALID_DATE', `${field} is invalid`);
    }
    return utcDateOnly(inst.getUTCFullYear(), inst.getUTCMonth() + 1, inst.getUTCDate());
  }

  throw new AppError(
    400,
    'INVALID_DATE',
    `${field} must be YYYY-MM-DD or an ISO-8601 timestamp with explicit timezone`,
  );
}

export function formatBusinessDate(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function utcDateOnly(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

function isValidYmd(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
