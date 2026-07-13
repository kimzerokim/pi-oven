#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export interface RemediationBaselineReport {
  legacyHealthyAgentRefs: number;
  staleSlashCommands: number;
  invalidTaskExamples: number;
  providerTierAliases: number;
}

const ROOT = resolve(import.meta.dir, "..");
const MARKDOWN_SURFACE_ROOTS = ["agents", "skills"] as const;

function walkFiles(root: string, path: string): string[] {
  const absolute = join(root, path);
  const files: string[] = [];
  for (const entry of readdirSync(absolute).sort()) {
    const child = join(absolute, entry);
    if (statSync(child).isDirectory()) files.push(...walkFiles(root, relative(root, child)));
    else files.push(relative(root, child));
  }
  return files;
}

function countMatches(content: string, pattern: RegExp): number {
  return [...content.matchAll(pattern)].length;
}

const INVALID_TASK_EXAMPLE_MARKERS = [
  ["agents/pov-metis.md", 'task(subagent_type="pov:explorer"'],
  ["agents/pov-metis.md", 'task(subagent_type="pov:librarian"'],
  ["skills/codebase-survey/SKILL.md", "model: \"sonnet\""],
  ["skills/subagent-driven-development/references/prompts.md", "task:\n  description: \"Implement Task N"],
  ["skills/subagent-driven-development/references/prompts.md", "task:\n  description: \"Spec compliance review"],
  ["skills/subagent-driven-development/references/prompts.md", "task:\n  description: \"Code quality review"],
  ["skills/spec-and-review/references/pattern-loop.md", 'task(\n  prompt: "Draft a spec'],
  ["skills/spec-and-review/references/pattern-loop.md", 'task(\n  prompt: """\nRevise the spec'],
  ["skills/large-task-delegation/references/dispatch-anatomy.md", "<executor prompt for module A>"],
  ["skills/large-task-delegation/references/dispatch-anatomy.md", "<executor prompt for module B>"],
  ["skills/large-task-delegation/references/dispatch-anatomy.md", "<critic/verifier prompt referencing Wave 1 output>"],
] as const;

export async function inspectRemediationBaseline(
  root = ROOT
): Promise<RemediationBaselineReport> {
  const healthyFiles = MARKDOWN_SURFACE_ROOTS.flatMap((directory) =>
    walkFiles(root, directory)
  ).filter((file) => file.endsWith(".md"));

  let legacyHealthyAgentRefs = 0;
  let staleSlashCommands = 0;
  let providerTierAliases = 0;

  for (const file of healthyFiles.sort()) {
    const content = readFileSync(resolve(root, file), "utf8");
    legacyHealthyAgentRefs += countMatches(
      content,
      /(?<!\/)pi-oven:[a-z][a-z0-9-]*/g
    );
    staleSlashCommands += countMatches(content, /\/pi-oven:autonomous/g);
    if (file.startsWith("skills/")) {
      providerTierAliases += countMatches(content, /\b(?:sonnet|haiku|opus)\b/gi);
    }
  }

  const invalidTaskExamples = INVALID_TASK_EXAMPLE_MARKERS.reduce(
    (count, [file, marker]) =>
      count + (readFileSync(resolve(root, file), "utf8").includes(marker) ? 1 : 0),
    0
  );

  return {
    legacyHealthyAgentRefs,
    staleSlashCommands,
    invalidTaskExamples,
    providerTierAliases,
  };
}

export function formatRemediationBaselineReport(
  report: RemediationBaselineReport,
): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

if (import.meta.main) process.stdout.write(formatRemediationBaselineReport(await inspectRemediationBaseline()));
