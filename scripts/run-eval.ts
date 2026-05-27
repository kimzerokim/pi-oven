#!/usr/bin/env bun
/**
 * pi-oven eval runner (Plan 0 stub).
 *
 * Plan 1 implements the real runner using omp SDK
 * (createAgentSession + ModelRegistry).
 *
 * See docs/specs/2026-05-27-pi-oven-foundation-design.md Section 1-bis.
 */

interface EvalArgs {
  skill?: string;
  scenario?: string;
  tag?: string;
}

function parseArgs(argv: string[]): EvalArgs {
  const args: EvalArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--skill") args.skill = argv[++i];
    else if (a === "--scenario") args.scenario = argv[++i];
    else if (a === "--tag") args.tag = argv[++i];
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  console.log("pi-oven eval runner (Plan 0 stub)");
  console.log("Args:", JSON.stringify(args));
  console.log("→ No-op. Real runner in Plan 1.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
