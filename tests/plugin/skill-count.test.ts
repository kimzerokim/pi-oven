import { describe, it, expect } from "bun:test";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../");

describe("plugin.json version + skills count", () => {
  it("plugin.json version is 0.1.0", async () => {
    const plugin = await Bun.file(path.join(ROOT, ".claude-plugin/plugin.json")).json();
    expect(plugin.version).toBe("0.1.0");
  });

  it("plugin.json skills array has 17 entries", async () => {
    const plugin = await Bun.file(path.join(ROOT, ".claude-plugin/plugin.json")).json();
    expect(plugin.skills.length).toBe(17);
  });

  it("marketplace.json plugins[0].version is 0.1.0", async () => {
    const marketplace = await Bun.file(path.join(ROOT, ".claude-plugin/marketplace.json")).json();
    expect(marketplace.plugins[0].version).toBe("0.1.0");
  });
});
