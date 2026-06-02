import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const COMMANDS_DIR = path.resolve(__dirname, "../../commands");

// omp's "Claude Code Marketplace" discovery provider (`claude-plugins.ts`)
// registers a marketplace-plugin command as `${pluginName}:${basename(file)}`
// — the colon namespace. For pi-oven (installed as `pi-oven@kzk`) the
// pluginName is `pi-oven`, so a command file named `pi-oven-setup.md` would register
// as the redundant `/pi-oven:pi-oven-setup` (double "pi-oven"), never matching the
// documented `/pi-oven:setup`. Command filenames therefore MUST NOT carry the
// `pi-oven-` plugin-name prefix; the basename alone becomes the slash command.
describe("command file namespacing", () => {
  it("no command file basename carries a redundant `pi-oven-` prefix", () => {
    const offenders = fs
      .readdirSync(COMMANDS_DIR)
      .filter((f) => f.endsWith(".md") && f.startsWith("pi-oven-"));
    expect(offenders).toEqual([]);
  });
});
