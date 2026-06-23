import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const COMMANDS_DIR = path.resolve(__dirname, "../../commands");
const README_PATH = path.resolve(__dirname, "../../README.md");
const commandFiles = fs.readdirSync(COMMANDS_DIR).filter((file) => file.endsWith(".md"));
function findForbiddenResolverPatterns(text: string): string[] {
  return [
    /\bjq\b/.test(text) ? "jq" : null,
    /\bls\s+-d\b/.test(text) ? "ls -d" : null,
    /\bbun\s+scripts\//.test(text) ? "bare bun scripts/" : null,
  ].filter((hit): hit is string => hit !== null);
}

// omp's "Claude Code Marketplace" discovery provider (`claude-plugins.ts`)
// registers a marketplace-plugin command as `${pluginName}:${basename(file)}`
// — the colon namespace. For pi-oven (installed as `pi-oven@kzk`) the
// pluginName is `pi-oven`, so a command file named `pi-oven-setup.md` would register
// as the redundant `/pi-oven:pi-oven-setup` (double "pi-oven"), never matching the
// documented `/pi-oven:setup`. Command filenames therefore MUST NOT carry the
// `pi-oven-` plugin-name prefix; the basename alone becomes the slash command.
describe("command file namespacing", () => {
  it("no command file basename carries a redundant `pi-oven-` prefix", () => {
    const offenders = commandFiles.filter((file) => file.startsWith("pi-oven-"));
    expect(offenders).toEqual([]);
  });

  it("command markdown forbids brittle resolver snippets and bare script dispatch", () => {
    const offenders = commandFiles.flatMap((file) => {
      const hits = findForbiddenResolverPatterns(fs.readFileSync(path.join(COMMANDS_DIR, file), "utf8"));
      return hits.length === 0 ? [] : [`${file}: ${hits.join(", ")}`];
    });

    expect(offenders).toEqual([]);
  });

  it("README examples avoid brittle resolver snippets and bare script dispatch", () => {
    expect(findForbiddenResolverPatterns(fs.readFileSync(README_PATH, "utf8"))).toEqual([]);
  });

  it("doctor and setup docs reflect the current auth and prerequisite contract", () => {
    const doctorText = fs.readFileSync(path.join(COMMANDS_DIR, "doctor.md"), "utf8");
    const setupText = fs.readFileSync(path.join(COMMANDS_DIR, "setup.md"), "utf8");
    const readmeText = fs.readFileSync(README_PATH, "utf8");

    expect(doctorText).toContain("The `provider auth` check FAILs");
    expect(doctorText).not.toContain("The `provider auth` check WARNs");
    expect(doctorText).toContain("/pi-oven:setup --repair-prereqs");
    expect(setupText).toContain("--repair-prereqs");
    expect(setupText).toContain("This path is **global-only**");
    expect(readmeText).toContain("/pi-oven:doctor");
    expect(readmeText).toContain("/pi-oven:release --bump patch --dry-run --update-changelog --sync-label");
  });
});
