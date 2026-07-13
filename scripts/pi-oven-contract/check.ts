#!/usr/bin/env bun

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { basename, extname, join, resolve } from "node:path";

import { ROLE_NAMES } from "../../.omp/extensions/pi-oven-runtime/runtime-contract";
import { scanMarkdown, locationAt } from "./markdown-scanner";
import { parseTaskExample } from "./task-example-parser";
import { generatedArtifacts, renderGeneratedArtifacts } from "./generate";

export type AuthoredSurfaceIssueCode =
  | "legacy-agent-reference"
  | "provider-tier-alias"
  | "unregistered-slash-command"
  | "unclassified-task-example"
  | "invalid-task-example"
  | "unknown-agent-file"
  | "agent-frontmatter-name-mismatch"
  | "generated-content-drift"
  | "archive-missing-historical-banner";

export interface AuthoredSurfaceIssue {
  code: AuthoredSurfaceIssueCode | string;
  file: string;
  line: number;
  column: number;
  message: string;
  suggestion: string;
}

export interface AuthoredSurfaceReport {
  issues: AuthoredSurfaceIssue[];
  inspectedFiles: string[];
}

export interface InspectAuthoredSurfacesOptions {
  root?: string;
  checkGenerated?: boolean;
}

const DEFAULT_ROOT = resolve(import.meta.dir, "../..");
const roleSet = new Set<string>(ROLE_NAMES);

function walk(root: string, path: string, predicate: (file: string) => boolean): string[] {
  const absolute = join(root, path);
  if (!existsSync(absolute)) return [];
  if (!statSync(absolute).isDirectory()) return predicate(path) ? [path] : [];

  return readdirSync(absolute, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, "en"))
    .flatMap((entry) => {
      const child = join(path, entry.name);
      return entry.isDirectory() ? walk(root, child, predicate) : predicate(child) ? [child] : [];
    });
}

function healthyFiles(root: string): string[] {
  const files = [
    ...walk(root, ".claude-plugin/plugin.json", () => true),
    ...walk(root, "agents", (file) => extname(file) === ".md"),
    ...walk(root, "skills", (file) =>
      basename(file) === "SKILL.md" || (/\/references\//.test(file) && extname(file) === ".md")
    ),
    ...walk(root, "commands", (file) => extname(file) === ".md"),
    ...walk(root, "evals", (file) => [".yaml", ".yml"].includes(extname(file))),
    ...walk(root, "README.md", () => true),
    ...walk(root, "CLAUDE.md", () => true),
    ...walk(root, "docs/runtime-contracts", (file) => extname(file) === ".md"),
  ];
  return [...new Set(files)].sort((left, right) => left.localeCompare(right, "en"));
}

function archiveFiles(root: string): string[] {
  return [
    "docs/specs",
    "docs/baselines",
    "docs/harness/surveys",
    "docs/plans",
    "docs/pre-decisions",
  ].flatMap((path) => walk(root, path, (file) => extname(file) === ".md"))
    .sort((left, right) => left.localeCompare(right, "en"));
}

const HISTORICAL_BANNER = /(?:^|\n)(?:status:\s*historical\b|>\s*historical;\s*do not copy runtime syntax\b)/i;

function firstHistoricalSyntaxOffset(source: string): number | undefined {
  const rolePattern = ROLE_NAMES.join("|");
  const patterns = [
    new RegExp(`(?<!/)pi-oven:(?:${rolePattern})\\b`, "g"),
    /\/pi-oven:autonomous\b/g,
    /\b(?:subagent_type|run_in_background)\b/g,
    /\b(?:sonnet|haiku|opus)\b/gi,
  ];
  const offsets = patterns
    .map((pattern) => {
      pattern.lastIndex = 0;
      return pattern.exec(source)?.index;
    })
    .filter((offset): offset is number => offset !== undefined);
  return offsets.length > 0 ? Math.min(...offsets) : undefined;
}

function commandNamesFromManifest(root: string): string[] {
  const path = join(root, ".claude-plugin/plugin.json");
  if (!existsSync(path)) return [];
  const manifest = JSON.parse(readFileSync(path, "utf8")) as { commands?: unknown };
  if (!Array.isArray(manifest.commands)) return [];
  return manifest.commands
    .filter((command): command is string => typeof command === "string")
    .map((command) => `/pi-oven:${basename(command, extname(command))}`)
    .sort((left, right) => left.localeCompare(right, "en"));
}

function pushMatches(
  issues: AuthoredSurfaceIssue[],
  file: string,
  source: string,
  pattern: RegExp,
  create: (match: RegExpExecArray) => Omit<AuthoredSurfaceIssue, "file" | "line" | "column"> | null,
): void {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const issue = create(match);
    if (issue === null) continue;
    const location = locationAt(source, match.index);
    issues.push({ ...issue, file, ...location });
  }
}

export async function inspectAuthoredSurfaces(
  options: InspectAuthoredSurfacesOptions = {},
): Promise<AuthoredSurfaceReport> {
  const root = resolve(options.root ?? DEFAULT_ROOT);
  const healthy = healthyFiles(root);
  const archive = archiveFiles(root);
  const inspectedFiles = [...healthy, ...archive].sort((left, right) => left.localeCompare(right, "en"));
  const commands = commandNamesFromManifest(root);
  const commandSet = new Set(commands);
  const issues: AuthoredSurfaceIssue[] = [];

  for (const file of healthy) {
    const source = readFileSync(join(root, file), "utf8");

    if (file.startsWith("agents/")) {
      const fileMatch = basename(file).match(/^pov-([a-z][a-z0-9-]*)\.md$/);
      if (fileMatch) {
        const role = fileMatch[1];
        if (!roleSet.has(role)) {
          issues.push({
            code: "unknown-agent-file",
            file,
            line: 1,
            column: 1,
            message: `Agent file ${basename(file)} does not belong to the runtime roster.`,
            suggestion: "Remove it or use one of the ROLE_NAMES filenames.",
          });
        } else {
          const nameMatch = source.match(/^name:\s*([^\n]+?)\s*$/m);
          const expected = `pov:${role}`;
          if (nameMatch?.[1] !== expected) {
            const location = nameMatch
              ? locationAt(source, nameMatch.index ?? 0)
              : { line: 1, column: 1 };
            issues.push({
              code: "agent-frontmatter-name-mismatch",
              file,
              ...location,
              message: `Agent frontmatter name must be ${expected}; found ${nameMatch?.[1] ?? "(missing)"}.`,
              suggestion: `Set frontmatter name to ${expected}.`,
            });
          }
        }
      } else {
        issues.push({
          code: "unknown-agent-file",
          file,
          line: 1,
          column: 1,
          message: `Agent file ${basename(file)} does not use a registered pov-<role>.md filename.`,
          suggestion: "Use a filename derived from ROLE_NAMES.",
        });
      }
    }

    pushMatches(
      issues,
      file,
      source,
      /(?<!\/)pi-oven:([a-z][a-z0-9-]*)/g,
      (match) => {
        const role = match[1];
        if (!roleSet.has(role)) return null;
        return {
          code: "legacy-agent-reference",
          message: `Legacy agent reference ${match[0]} is not executable.`,
          suggestion: `Use pov:${role}.`,
        };
      },
    );

    pushMatches(issues, file, source, /\/pi-oven:[a-z][a-z0-9-]*/g, (match) => ({
      code: "unregistered-slash-command",
      message: `Slash command ${match[0]} is not registered by the plugin manifest.`,
      suggestion: `Use one of: ${commands.join(", ") || "(none)"}.`,
    }));
    for (let index = issues.length - 1; index >= 0; index--) {
      const issue = issues[index];
      if (issue.file === file && issue.code === "unregistered-slash-command") {
        const line = source.split(/\r?\n/)[issue.line - 1] ?? "";
        const token = line.slice(issue.column - 1).match(/^\/pi-oven:[a-z][a-z0-9-]*/)?.[0];
        if (token && commandSet.has(token)) issues.splice(index, 1);
      }
    }

    if (file.startsWith("skills/")) {
      pushMatches(issues, file, source, /\b(sonnet|haiku|opus)\b/gi, (match) => ({
        code: "provider-tier-alias",
        message: `Provider-tier routing alias ${match[0]} is not part of the runtime contract.`,
        suggestion: "Describe the pov role; task.agentModelOverrides owns model routing.",
      }));
    }

    if (extname(file) === ".md") {
      for (const fence of scanMarkdown(source).fences) {
        const hasExecutableTask = /\btask\s*\(/.test(fence.content) && !/\btask\s*\(\s*\.\.\.\s*\)/.test(fence.content);
        if (fence.markerLine === undefined) {
          if (hasExecutableTask) {
            issues.push({
              code: "unclassified-task-example",
              file,
              line: fence.contentLine,
              column: 1,
              message: "Executable task(...) example is not classified for contract validation.",
              suggestion: "Add <!-- pi-oven-contract:task-example --> immediately before the fence.",
            });
          }
          continue;
        }

        const parsed = parseTaskExample(fence.content);
        if (!parsed.ok) {
          issues.push({
            code: "invalid-task-example",
            file,
            line: fence.contentLine,
            column: 1,
            message: `Tagged task example is invalid: ${parsed.message}`,
            suggestion: "Use one literal task({ agent, tasks }) call conforming to the canonical schema.",
          });
        }
      }
    }
  }

  for (const file of archive) {
    const source = readFileSync(join(root, file), "utf8");
    const staleOffset = firstHistoricalSyntaxOffset(source);
    if (staleOffset !== undefined && !HISTORICAL_BANNER.test(source.slice(0, 1_500))) {
      const location = locationAt(source, staleOffset);
      issues.push({
        code: "archive-missing-historical-banner",
        file,
        ...location,
        message: "Archive/evidence document contains historical runtime syntax without a warning banner.",
        suggestion: "Add `> Historical; do not copy runtime syntax from this document.` near the top.",
      });
    }
  }

  if (options.checkGenerated !== false) {
    const expected = renderGeneratedArtifacts();
    for (const file of generatedArtifacts) {
      const path = join(root, file);
      const actual = existsSync(path) ? readFileSync(path, "utf8") : undefined;
      if (actual !== expected[file]) {
        issues.push({
          code: "generated-content-drift",
          file,
          line: 1,
          column: 1,
          message: `${file} is missing or differs from the RuntimeContract output.`,
          suggestion: "Run bun run contract:generate and commit the result.",
        });
      }
    }
  }

  issues.sort((left, right) =>
    left.file.localeCompare(right.file, "en") ||
    left.line - right.line ||
    left.column - right.column ||
    left.code.localeCompare(right.code, "en")
  );
  return { issues, inspectedFiles };
}

export function formatAuthoredSurfaceReport(report: AuthoredSurfaceReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

if (import.meta.main) {
  const report = await inspectAuthoredSurfaces();
  process.stdout.write(formatAuthoredSurfaceReport(report));
  if (report.issues.length > 0) process.exitCode = 1;
}
