/**
 * Utility functions for formatting ISO 8601 timestamps.
 * All functions operate on UTC time using Date objects.
 */

/**
 * Format a Date as a complete ISO 8601 timestamp string (YYYY-MM-DDTHH:MM:SS.mmmZ).
 *
 * @param date - The Date object to format
 * @returns ISO 8601 formatted string with milliseconds and Z suffix
 *
 * @example
 * formatISO(new Date("2026-06-04T15:30:45.123Z"))
 * // => "2026-06-04T15:30:45.123Z"
 */
export function formatISO(date: Date): string {
  return date.toISOString();
}

/**
 * Format a Date as an ISO 8601 date string (YYYY-MM-DD).
 *
 * @param date - The Date object to format
 * @returns ISO 8601 date string
 *
 * @example
 * formatISODate(new Date("2026-06-04T15:30:45.123Z"))
 * // => "2026-06-04"
 */
export function formatISODate(date: Date): string {
  // toISOString() always returns "YYYY-MM-DDTHH:MM:SS.mmmZ"
  // Extract date part: positions 0-10 (YYYY-MM-DD)
  return date.toISOString().substring(0, 10);
}

/**
 * Format a Date as an ISO 8601 time string (HH:MM:SS.mmm).
 *
 * @param date - The Date object to format
 * @returns ISO 8601 time string with milliseconds, excluding timezone
 *
 * @example
 * formatISOTime(new Date("2026-06-04T15:30:45.123Z"))
 * // => "15:30:45.123"
 */
export function formatISOTime(date: Date): string {
  // toISOString() always returns "YYYY-MM-DDTHH:MM:SS.mmmZ"
  // Extract time part: positions 11-23 (HH:MM:SS.mmm)
  return date.toISOString().substring(11, 23);
}
