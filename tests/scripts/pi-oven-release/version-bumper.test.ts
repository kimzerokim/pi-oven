import { describe, expect, it } from "bun:test";
import { bumpVersion, parseSemver } from "../../../scripts/pi-oven-release/version-bumper";

describe("version-bumper", () => {
  it("bumps patch", () => {
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
  });

  it("bumps minor", () => {
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
  });

  it("bumps major", () => {
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });

  it("rejects invalid semver", () => {
    expect(() => parseSemver("1.2")).toThrow("Invalid semver");
  });
});
