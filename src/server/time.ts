import "server-only";

/**
 * Jakarta is a fixed UTC+7 zone (no DST), so a Jakarta calendar day maps to a fixed UTC range.
 * These helpers return UTC Date bounds for SQL range filters, which keeps index use on approved_at.
 */
const OFFSET_MS = 7 * 60 * 60 * 1000;

export function dayRangeUtc(dateKey: string): { start: Date; end: Date } {
  const [y, m, d] = dateKey.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d) - OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export function monthRangeUtc(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1) - OFFSET_MS);
  const end = new Date(Date.UTC(year, month, 1) - OFFSET_MS);
  return { start, end };
}

export function isValidDateKey(value: string | undefined | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

/** SQL expression converting a UTC DATETIME column to a Jakarta DATE. */
export function jakartaDateSql(column: string): string {
  return `DATE(DATE_ADD(${column}, INTERVAL 7 HOUR))`;
}
