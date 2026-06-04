import { describe, it, expect } from "bun:test";
import { formatISO, formatISODate, formatISOTime } from "../../scripts/lib/date-utils";

describe("date-utils", () => {
  describe("formatISO", () => {
    it("formats Date as ISO 8601 string with milliseconds", () => {
      const date = new Date("2026-06-04T15:30:45.123Z");
      const result = formatISO(date);
      expect(result).toBe("2026-06-04T15:30:45.123Z");
    });

    it("formats Date as ISO 8601 without timezone offset", () => {
      const date = new Date("2025-01-15T08:22:10.456Z");
      const result = formatISO(date);
      expect(result).toBe("2025-01-15T08:22:10.456Z");
    });

    it("handles midnight UTC", () => {
      const date = new Date("2026-06-04T00:00:00.000Z");
      const result = formatISO(date);
      expect(result).toBe("2026-06-04T00:00:00.000Z");
    });
  });

  describe("formatISODate", () => {
    it("formats Date as ISO 8601 date only (YYYY-MM-DD)", () => {
      const date = new Date("2026-06-04T15:30:45.123Z");
      const result = formatISODate(date);
      expect(result).toBe("2026-06-04");
    });

    it("handles year boundaries", () => {
      const date = new Date("2025-01-01T00:00:00.000Z");
      const result = formatISODate(date);
      expect(result).toBe("2025-01-01");
    });
  });

  describe("formatISOTime", () => {
    it("formats Date as ISO 8601 time with milliseconds (HH:MM:SS.mmm)", () => {
      const date = new Date("2026-06-04T15:30:45.123Z");
      const result = formatISOTime(date);
      expect(result).toBe("15:30:45.123");
    });

    it("handles midnight UTC", () => {
      const date = new Date("2026-06-04T00:00:00.000Z");
      const result = formatISOTime(date);
      expect(result).toBe("00:00:00.000");
    });

    it("formats end-of-day", () => {
      const date = new Date("2026-06-04T23:59:59.999Z");
      const result = formatISOTime(date);
      expect(result).toBe("23:59:59.999");
    });
  });

  describe("edge cases", () => {
    it("handles millisecond boundary correctly", () => {
      const date = new Date("2026-06-04T15:30:45.001Z");
      expect(formatISO(date)).toBe("2026-06-04T15:30:45.001Z");
      expect(formatISOTime(date)).toBe("15:30:45.001");
    });

    it("formatISO is idempotent when parsing result", () => {
      const original = new Date("2026-06-04T15:30:45.123Z");
      const formatted = formatISO(original);
      const reparsed = new Date(formatted);
      expect(formatISO(reparsed)).toBe(formatted);
    });
  });
});
