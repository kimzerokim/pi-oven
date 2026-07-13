export const EXPLICIT_SKILL_SAFETY_CEILING = 16;
export const DEFAULT_MAX_IMPLICIT_ROOTS = 8;

export type RuntimeSkillPhase = "explore" | "plan" | "mutate" | "verify";
export type RuntimeSkillClass = "root" | "deferred";

export interface RuntimeSkillClassification {
  class: RuntimeSkillClass;
  phases: RuntimeSkillPhase[];
  priority: number;
}

export interface SkillSelectionIndexEntry {
  name: string;
  description: string;
  phrases: string[];
  ownedReadTarget: string;
  pluginRoot: string;
  manifestOrder?: number;
}

export interface SelectedSkill {
  name: string;
  rawMatchedPhrases: string[];
  ownedReadTarget: string;
  pluginRoot: string;
  phases: RuntimeSkillPhase[];
  explicit: boolean;
  class: RuntimeSkillClass;
  priority: number;
  specificity: number;
  manifestOrder: number;
  deferred?: boolean;
}

export interface SkillSelectionReceipt {
  explicit: SelectedSkill[];
  implicitRoot: SelectedSkill[];
  deferred: SelectedSkill[];
  dropped: Array<SelectedSkill & { reason: string }>;
  maxImplicitRoots: number;
}

const ROOT_CAPABLE_SKILLS = new Set([
  "autonomous-loop",
  "deep-dive",
  "systematic-debugging",
  "spec-and-review",
  "writing-plans",
  "brainstorming",
  "improve-codebase-architecture",
  "receiving-code-review",
  "html-research-orchestrator",
]);

export const RUNTIME_SKILL_CLASSIFICATION: Record<string, RuntimeSkillClassification> = {
  "autonomous-loop": {
    class: "root",
    phases: ["explore", "plan", "mutate", "verify"],
    priority: 100,
  },
  "deep-dive": { class: "root", phases: ["explore", "plan"], priority: 90 },
  "systematic-debugging": { class: "root", phases: ["explore", "mutate", "verify"], priority: 95 },
  "spec-and-review": { class: "root", phases: ["explore", "plan", "verify"], priority: 80 },
  "writing-plans": { class: "root", phases: ["explore", "plan"], priority: 70 },
  brainstorming: { class: "root", phases: ["plan"], priority: 60 },
  "improve-codebase-architecture": { class: "root", phases: ["explore", "plan"], priority: 75 },
  "receiving-code-review": { class: "root", phases: ["mutate", "verify"], priority: 85 },
  "html-research-orchestrator": { class: "root", phases: ["explore", "plan"], priority: 65 },
  "memory-discipline": { class: "deferred", phases: ["verify"], priority: 10 },
  "code-quality-discipline": { class: "deferred", phases: ["mutate", "verify"], priority: 30 },
  "tdd-strict": { class: "deferred", phases: ["mutate", "verify"], priority: 35 },
  "codebase-survey": { class: "deferred", phases: ["explore"], priority: 20 },
  "fresh-verifier": { class: "deferred", phases: ["verify"], priority: 40 },
  "pre-commit-gate": { class: "deferred", phases: ["verify"], priority: 45 },
  "large-task-delegation": { class: "deferred", phases: ["plan", "mutate"], priority: 25 },
  "subagent-driven-development": { class: "deferred", phases: ["mutate"], priority: 25 },
  "git-workflow": { class: "deferred", phases: ["mutate", "verify"], priority: 30 },
  aws: { class: "deferred", phases: ["explore"], priority: 20 },
  cloudflare: { class: "deferred", phases: ["explore"], priority: 20 },
  "bitbucket-pipeline": { class: "deferred", phases: ["explore", "verify"], priority: 20 },
  "html-spec-decision-maker": { class: "deferred", phases: ["plan"], priority: 15 },
  "deep-init": { class: "deferred", phases: ["explore"], priority: 15 },
};

export class ExplicitSkillSafetyCeilingError extends Error {
  readonly code = "PI_OVEN_EXPLICIT_SKILL_SAFETY_CEILING";

  constructor(
    readonly explicitSkills: SelectedSkill[],
    readonly ceiling: number = EXPLICIT_SKILL_SAFETY_CEILING
  ) {
    super(
      `pi-oven: explicit skill safety ceiling exceeded (${explicitSkills.length} > ${ceiling}): ${explicitSkills
        .map((skill) => skill.name)
        .join(", ")}`
    );
    this.name = "ExplicitSkillSafetyCeilingError";
  }
}

function localSkillName(publicSkillName: string): string {
  return publicSkillName.startsWith("pov:") ? publicSkillName.slice("pov:".length) : publicSkillName;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasToken(text: string, token: string): boolean {
  const escaped = escapeRegExp(token);
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}_:/$-])${escaped}(?=$|[^\\p{L}\\p{N}_:/$-])`,
    "iu"
  ).test(text);
}

export function hasExplicitSkillAlias(text: string, publicSkillName: string): boolean {
  const local = localSkillName(publicSkillName);
  return [`pov:${local}`, `$${local}`, `/${local}`].some((alias) => hasToken(text, alias));
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/["'“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function classificationFor(name: string): RuntimeSkillClassification {
  const local = localSkillName(name);
  return (
    RUNTIME_SKILL_CLASSIFICATION[local] ??
    (ROOT_CAPABLE_SKILLS.has(local)
      ? { class: "root", phases: ["explore", "plan", "mutate", "verify"], priority: 50 }
      : { class: "deferred", phases: ["mutate", "verify"], priority: 0 })
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareEntries(left: SkillSelectionIndexEntry, right: SkillSelectionIndexEntry): number {
  const leftOrder = left.manifestOrder ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.manifestOrder ?? Number.MAX_SAFE_INTEGER;
  return (
    leftOrder - rightOrder ||
    compareText(left.name, right.name) ||
    compareText(left.ownedReadTarget, right.ownedReadTarget)
  );
}

function compareSelectedSkills(left: SelectedSkill, right: SelectedSkill): number {
  return (
    right.priority - left.priority ||
    right.specificity - left.specificity ||
    left.manifestOrder - right.manifestOrder ||
    compareText(left.name, right.name)
  );
}

function canonicalEntries(index: SkillSelectionIndexEntry[]): SkillSelectionIndexEntry[] {
  const byName = new Map<string, SkillSelectionIndexEntry>();
  for (const entry of [...index].sort(compareEntries)) {
    if (!byName.has(entry.name)) byName.set(entry.name, entry);
  }
  return [...byName.values()];
}

function matchedPhrases(text: string, phrases: string[]): string[] {
  const normalizedText = normalizeText(text);
  const hits = new Set<string>();
  for (const phrase of phrases) {
    const normalizedPhrase = normalizeText(phrase);
    if (normalizedPhrase && normalizedText.includes(normalizedPhrase)) hits.add(normalizedPhrase);
  }
  return [...hits].sort(compareText);
}

export function selectSkillsForTurn(input: {
  latestUserText: string;
  index: SkillSelectionIndexEntry[];
  maxImplicitRoots: number;
}): SkillSelectionReceipt {
  if (!Number.isSafeInteger(input.maxImplicitRoots) || input.maxImplicitRoots < 0) {
    throw new RangeError("maxImplicitRoots must be a non-negative safe integer");
  }

  const candidates = canonicalEntries(input.index)
    .map((entry) => {
      const rawMatchedPhrases = matchedPhrases(input.latestUserText, entry.phrases);
      const explicit = hasExplicitSkillAlias(input.latestUserText, entry.name);
      if (!explicit && rawMatchedPhrases.length === 0) return null;
      const classification = classificationFor(entry.name);
      return {
        name: entry.name,
        rawMatchedPhrases,
        ownedReadTarget: entry.ownedReadTarget,
        pluginRoot: entry.pluginRoot,
        phases: [...classification.phases],
        explicit,
        class: classification.class,
        priority: classification.priority,
        specificity: rawMatchedPhrases.reduce((max, phrase) => Math.max(max, phrase.length), 0),
        manifestOrder: entry.manifestOrder ?? Number.MAX_SAFE_INTEGER,
      } satisfies SelectedSkill;
    })
    .filter((candidate): candidate is SelectedSkill => candidate !== null);

  const explicit = candidates.filter((candidate) => candidate.explicit).sort(compareSelectedSkills);
  if (explicit.length > EXPLICIT_SKILL_SAFETY_CEILING) {
    throw new ExplicitSkillSafetyCeilingError(explicit);
  }

  const implicit = candidates.filter((candidate) => !candidate.explicit);
  const rankedImplicitRoots = implicit
    .filter((candidate) => candidate.class === "root")
    .sort(compareSelectedSkills);
  const implicitRoot = rankedImplicitRoots.slice(0, input.maxImplicitRoots);
  const implicitRootNames = new Set(implicitRoot.map((candidate) => candidate.name));
  const deferred = implicit
    .filter((candidate) => !implicitRootNames.has(candidate.name))
    .sort(compareSelectedSkills)
    .map((candidate) => ({ ...candidate, deferred: true }));

  return { explicit, implicitRoot, deferred, dropped: [], maxImplicitRoots: input.maxImplicitRoots };
}
