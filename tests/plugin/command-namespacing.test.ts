import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const COMMANDS_DIR = path.resolve(__dirname, "../../commands");
const README_PATH = path.resolve(__dirname, "../../README.md");
const CLAUDE_PATH = path.resolve(__dirname, "../../CLAUDE.md");
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

  it("doctor, setup, README, and CLAUDE docs reflect the current runtime-owned routing contract", () => {
    const doctorText = fs.readFileSync(path.join(COMMANDS_DIR, "doctor.md"), "utf8");
    const setupText = fs.readFileSync(path.join(COMMANDS_DIR, "setup.md"), "utf8");
    const readmeText = fs.readFileSync(README_PATH, "utf8");
    const claudeText = fs.readFileSync(CLAUDE_PATH, "utf8");

    expect(doctorText).toContain("The `provider auth` check FAILs");
    expect(doctorText).not.toContain("The `provider auth` check WARNs");
    expect(doctorText).toContain("/pi-oven:setup --repair-prereqs");
    expect(doctorText).toContain("runtime still owns the current-session provider-family choice");
    expect(doctorText).toContain("visible runtime agent+skill namespace is `pov:*`");

    expect(setupText).toContain("--repair-prereqs");
    expect(setupText).toContain("This path is **global-only**");
    expect(setupText).toContain("There is no profile selection question");
    expect(setupText).toContain("Every interactive setup question MUST use the `pi-oven_ask` tool");
    expect(setupText).toContain('Use this exact question: "Proceed with codex-only DEFAULT_PROFILE?"');
    expect(setupText).toContain('Use this exact question: "Ready to persist pi-oven routing. Proceed?"');
    expect(setupText).toContain('Question: "One or more roles are UNVERIFIED. How should setup proceed?"');
    expect(setupText).not.toContain("[Y/n]");
    expect(setupText).not.toContain("[y/N]");
    expect(setupText).not.toContain("affordances: { other: false, askAboutChoices: true }");
    expect(setupText).toContain("runtime agents and skills are `pov:*`");
    expect(setupText).toContain("`pi-oven@kzk`");
    expect(setupText).not.toContain("It takes no other arguments");
    expect(setupText).not.toContain("pi-oven:<role>");

    expect(readmeText).toContain("/pi-oven:doctor");
    expect(readmeText).toContain("/pi-oven:release --bump patch --dry-run --update-changelog --sync-label");
    expect(readmeText).toContain("approvalFlow");
    expect(readmeText).not.toContain("Ask about these choices");
    expect(readmeText).toContain("Use pov:explorer");
    expect(readmeText).toContain("pov:verifier");
    expect(readmeText).toContain('Unknown agent "pov:executor"');
    expect(readmeText).not.toContain('Unknown agent "pi-oven:executor"');

    expect(claudeText).toContain("approvalFlow");
    expect(claudeText).toContain("askAboutChoices");
    expect(claudeText).toContain("Runtime dispatch names MUST be `pov:<role>`");
    expect(claudeText).not.toContain("Agent name frontmatter MUST be `pi-oven:<role>`");
  });
});
