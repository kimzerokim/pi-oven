#!/usr/bin/env bun

export {};

type DocKind = "survey" | "research";

type LocalAnchor = {
  raw: string;
  path: string;
};

const HEADING_RE = /^##+\s+(.+)$/gm;
const LOCAL_ANCHOR_RE =
  /(?:^|[\s(`])(?<path>\.?[A-Za-z0-9_./-]+\.[A-Za-z0-9_-]+):(?<lines>\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)/gm;
const URL_RE = /https?:\/\/[^\s)>]+/g;
const OFFICIAL_DOC_HOSTS: Record<string, true> = {
  "developer.apple.com": true,
  "developer.chrome.com": true,
  "developer.mozilla.org": true,
  "developers.openai.com": true,
  "docs.aws.amazon.com": true,
  "docs.bun.sh": true,
  "docs.github.com": true,
  "docs.python.org": true,
  "kubernetes.io": true,
  "learn.microsoft.com": true,
  "nodejs.org": true,
  "openai.com": true,
  "platform.openai.com": true,
  "react.dev": true,
  "typescriptlang.org": true,
};

function normalizeHeading(value: string): string {
  return value.trim().toLowerCase().replace(/^\d+(?:\.\d+)*\.?\s+/, "");
}

function collectHeadings(content: string): string[] {
  return [...content.matchAll(HEADING_RE)].map((match) => normalizeHeading(match[1] ?? ""));
}

function collectLocalAnchors(content: string): LocalAnchor[] {
  return [...content.matchAll(LOCAL_ANCHOR_RE)].map((match) => ({
    raw: match[0].trim(),
    path: match.groups?.path ?? "",
  }));
}

function collectUrls(content: string): string[] {
  return [...content.matchAll(URL_RE)].map((match) => match[0]);
}

function hasHeading(headings: string[], pattern: RegExp): boolean {
  return headings.some((heading) => pattern.test(heading));
}

function isOfficialUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    return OFFICIAL_DOC_HOSTS[host] === true || host.endsWith(".openai.com");
  } catch {
    return false;
  }
}

function detectKind(path: string, content: string): DocKind | null {
  const lowerPath = path.toLowerCase();
  const lowerContent = content.toLowerCase();

  if (lowerPath.includes("/research/")) {
    return "research";
  }

  if (lowerPath.includes("/surveys/")) {
    return "survey";
  }

  if (lowerContent.includes("research memo")) {
    return "research";
  }

  if (lowerContent.includes("implementation-facing survey")) {
    return "survey";
  }

  const basename = lowerPath.split("/").pop() ?? lowerPath;
  if (basename.includes("research")) {
    return "research";
  }

  if (basename.includes("survey")) {
    return "survey";
  }

  return null;
}

function validateSurvey(content: string): string[] {
  const errors: string[] = [];
  const headings = collectHeadings(content);
  const anchors = collectLocalAnchors(content);
  const uniqueFiles = new Set(anchors.map((anchor) => anchor.path));
  const hasTestSurface = anchors.some((anchor) => anchor.path.includes("tests/"));
  const hasImplementationSurface = anchors.some((anchor) => !anchor.path.includes("tests/"));

  if (!hasHeading(headings, /^scope$/i)) {
    errors.push("missing required ## Scope section");
  }

  if (!hasHeading(headings, /^(explicit\s+)?unknowns$/i)) {
    errors.push("missing explicit unknowns section");
  }

  if (!hasHeading(headings, /^(findings|current reality|working-state snapshot|local evidence|module inventory)$/i)) {
    errors.push("missing implementation-facing findings/local evidence section");
  }

  if (anchors.length < 2 || uniqueFiles.size < 2) {
    errors.push(
      `needs more code-grounded exact local evidence (found ${anchors.length} local anchors across ${uniqueFiles.size} files)`
    );
  }

  if (!hasTestSurface || !hasImplementationSurface) {
    errors.push("must cite both implementation and test surfaces");
  }

  return errors;
}

function validateResearch(content: string): string[] {
  const errors: string[] = [];
  const headings = collectHeadings(content);
  const anchors = collectLocalAnchors(content);
  const uniqueFiles = new Set(anchors.map((anchor) => anchor.path));
  const officialUrls = collectUrls(content).filter(isOfficialUrl);

  if (!hasHeading(headings, /^scope$/i)) {
    errors.push("missing required ## Scope section");
  }

  if (!hasHeading(headings, /^executive summary$/i)) {
    errors.push("missing required ## Executive summary section");
  }

  if (!hasHeading(headings, /^(explicit\s+)?unknowns$/i)) {
    errors.push("missing explicit unknowns section");
  }

  if (
    !hasHeading(
      headings,
      /^(local evidence|current repo architecture for model routing|exact code\/doc\/test change surfaces|module inventory)$/i
    )
  ) {
    errors.push("missing implementation-facing local change surface section");
  }

  if (anchors.length < 3 || uniqueFiles.size < 3) {
    errors.push(
      `needs more code-grounded exact local evidence (found ${anchors.length} local anchors across ${uniqueFiles.size} files)`
    );
  }

  if (officialUrls.length < 2) {
    errors.push(`needs at least 2 official-source links (found ${officialUrls.length})`);
  }

  return errors;
}

async function validatePath(path: string): Promise<string[]> {
  const content = await Bun.file(path).text();
  const kind = detectKind(path, content);

  if (kind === "survey") {
    return validateSurvey(content);
  }

  if (kind === "research") {
    return validateResearch(content);
  }

  return ['unable to classify document as survey or research'];
}

async function main(): Promise<void> {
  const paths = process.argv.slice(2);

  if (paths.length === 0) {
    console.error("lint-doc-evidence: provide one or more survey/research markdown paths");
    process.exit(1);
  }

  let hasErrors = false;

  for (const path of paths) {
    const errors = await validatePath(path);
    if (errors.length === 0) {
      continue;
    }

    hasErrors = true;
    const label = path;
    for (const error of errors) {
      console.error(`lint-doc-evidence: ${label}: ${error}`);
    }
  }

  if (hasErrors) {
    process.exit(1);
  }
}

await main();
