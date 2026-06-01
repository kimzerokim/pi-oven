import { describe, it, expect } from "bun:test";
import {
  resolveLanguage,
  LANGUAGE_MAX_LEN,
} from "../../../.omp/extensions/pi-oven-runtime/language";

// ---------------------------------------------------------------------------
// resolveLanguage — canonical codes, free-form names, and the security
// boundary (Slice A — custom primary language).
//
//   - "ko" family / "en" family collapse to the canonical code.
//   - any other safe language name round-trips VERBATIM (casing preserved).
//   - the length cap + Unicode-letter whitelist reject prompt-injection
//     payloads (newlines incl. U+2028, backticks, <>, #, *, {}, ;).
// ---------------------------------------------------------------------------

describe("resolveLanguage — canonical codes", () => {
  it("collapses the ko family to 'ko' (case-insensitive)", () => {
    expect(resolveLanguage("ko")).toBe("ko");
    expect(resolveLanguage("KO")).toBe("ko");
    expect(resolveLanguage("Korean")).toBe("ko");
    expect(resolveLanguage("korean")).toBe("ko");
    expect(resolveLanguage("한국어")).toBe("ko");
    expect(resolveLanguage("  ko  ")).toBe("ko");
  });

  it("collapses the en family to 'en' (case-insensitive)", () => {
    expect(resolveLanguage("en")).toBe("en");
    expect(resolveLanguage("EN")).toBe("en");
    expect(resolveLanguage("English")).toBe("en");
    expect(resolveLanguage("english")).toBe("en");
    expect(resolveLanguage(" english ")).toBe("en");
  });
});

describe("resolveLanguage — free-form names (casing preserved)", () => {
  it("accepts Español verbatim", () => {
    expect(resolveLanguage("Español")).toBe("Español");
  });

  it("accepts 日本語 verbatim", () => {
    expect(resolveLanguage("日本語")).toBe("日本語");
  });

  it("round-trips a parenthesized name 'Português (Brasil)'", () => {
    expect(resolveLanguage("Português (Brasil)")).toBe("Português (Brasil)");
  });

  it("trims surrounding whitespace but preserves inner casing", () => {
    expect(resolveLanguage("  Français  ")).toBe("Français");
  });
});

describe("resolveLanguage — length + emptiness", () => {
  it("returns null for whitespace-only input", () => {
    expect(resolveLanguage("  ")).toBeNull();
    expect(resolveLanguage("")).toBeNull();
  });

  it("returns null for an over-length (41-char) name", () => {
    const tooLong = "a".repeat(LANGUAGE_MAX_LEN + 1);
    expect(tooLong.length).toBe(41);
    expect(resolveLanguage(tooLong)).toBeNull();
  });

  it("accepts a name exactly at the max length", () => {
    const atMax = "a".repeat(LANGUAGE_MAX_LEN);
    expect(resolveLanguage(atMax)).toBe(atMax);
  });
});

describe("resolveLanguage — injection payloads rejected (security boundary)", () => {
  it("rejects an embedded newline", () => {
    expect(resolveLanguage("ko\nrm -rf /")).toBeNull();
    expect(resolveLanguage("Español\ninjected")).toBeNull();
  });

  it("rejects a backtick-wrapped string", () => {
    expect(resolveLanguage("`whoami`")).toBeNull();
  });

  it("rejects HTML angle brackets", () => {
    expect(resolveLanguage("<b>")).toBeNull();
  });

  it("rejects a markdown heading marker", () => {
    expect(resolveLanguage("# h")).toBeNull();
  });

  it("rejects a semicolon command-chain", () => {
    expect(resolveLanguage("ko; rm -rf /")).toBeNull();
  });

  it("rejects curly-brace template syntax", () => {
    expect(resolveLanguage("{x}")).toBeNull();
  });

  it("rejects a U+2028 line-separator string", () => {
    expect(resolveLanguage("Espa nol injected")).toBeNull();
  });

  it("rejects a U+2029 paragraph-separator string", () => {
    expect(resolveLanguage("Espa nol injected")).toBeNull();
  });

  it("rejects an asterisk", () => {
    expect(resolveLanguage("a*b")).toBeNull();
  });
});
