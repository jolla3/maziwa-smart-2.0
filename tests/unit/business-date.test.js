import { parseBusinessDate, formatBusinessDate } from '../../src/shared/time/businessDate.js';

describe('businessDate helpers', () => {
  test('parses YYYY-MM-DD to UTC date-only', () => {
    const d = parseBusinessDate('2026-03-15', { field: 'yieldDate' });
    expect(formatBusinessDate(d)).toBe('2026-03-15');
    expect(d.getUTCHours()).toBe(0);
  });

  test('rejects invalid calendar day', () => {
    expect(() => parseBusinessDate('2026-02-30', { field: 'd' }))
      .toThrow(/valid calendar date|INVALID_DATE/);
  });

  test('rejects offset-less date-time', () => {
    expect(() => parseBusinessDate('2026-01-10T12:00:00', { field: 'd' }))
      .toThrow();
  });
});
