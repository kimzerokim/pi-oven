import { readFileSync } from "fs";
import * as path from "path";
import {
  resolveShippedSkillSurfaceEntry,
} from "../../../scripts/pi-oven-setup/shipped-skill-registry";
import { getCapabilitiesByTag } from "./capability-registry";
import {
  DEFAULT_MAX_IMPLICIT_ROOTS,
  RUNTIME_SKILL_CLASSIFICATION,
  selectSkillsForTurn,
  type RuntimeSkillClass,
  type RuntimeSkillClassification,
  type RuntimeSkillPhase,
  type SkillSelectionIndexEntry,
} from "./skill-selection";

export {
  RUNTIME_SKILL_CLASSIFICATION,
  type RuntimeSkillClass,
  type RuntimeSkillClassification,
  type RuntimeSkillPhase,
};

export const PUBLIC_SKILL_NS = "pov";
export const KEYWORD_SKILL_DEDUP_KEY = "pi-oven:keyword-skills@v1";

export const SKILL_KEYWORD_WHITELIST: Record<string, readonly string[]> = {
  "autonomous-loop": [
    "자율 실행",
    "자율실행",
    "자율로 돌려",
    "끝까지 끝내줘",
    "자는 동안 진행해",
    "계속 진행해",
    "멈추지 말고 진행해",
    "ralph로 돌려",
    "autopilot",
    "ralph",
    "ultrawork",
    "ulw",
    "full auto",
    "don't stop",
  ],
  aws: [
    "aws 상태 확인",
    "프로덕션 조회",
    "운영 인프라 조회",
    "check aws",
    "inspect cloudfront",
    "inspect s3",
    "cloudwatch 확인",
    "route53 확인",
  ],
  "bitbucket-pipeline": [
    "bitbucket pipeline",
    "bitbucket pipelines",
    "비트버킷 파이프라인",
    "파이프라인 실패",
    "빌드 실패",
  ],
  brainstorming: [
    "brainstorm",
    "brainstorming",
    "브레인스토밍",
    "아이디어 정리",
    "같이 설계",
    "설계부터 하자",
  ],
  cloudflare: [
    "cloudflare",
    "dns 점검",
    "레코드 확인",
    "cname",
    "a record",
    "클라우드플레어",
  ],
  "code-quality-discipline": [
    "코드 수정",
    "버그 수정",
    "리팩토링",
    "refactor",
    "tdd",
  ],
  "codebase-survey": [
    "코드서베이",
    "전수조사",
    "코드베이스 조사",
    "호출부 전수 확인",
    "survey the codebase",
    "survey the module",
    "caller inventory",
    "module inventory",
  ],
  "deep-dive": [
    "deep dive",
    "deep-dive",
    "trace and clarify",
    "deep investigation",
    "investigate deeply",
    "research this",
    "dig into",
    "깊게 조사",
  ],
  "deep-init": [
    "deepinit",
    "deep-init",
    "딥이닛",
    "프로젝트 컨텍스트 초기화",
    "init project context",
    "scan codebase and write agents",
  ],
  "fresh-verifier": [
    "최종 검증",
    "완료 전 검증",
    "fresh verify",
    "verify before done",
  ],
  "git-workflow": [
    "worktree",
    "isolated workspace",
    "finish branch",
    "merge branch",
    "create pr",
    "discard branch",
    "branch cleanup",
    "워크트리",
    "브랜치 정리",
    "작업 마무리",
    "pr 만들어",
    "머지",
  ],
  "html-research-orchestrator": [
    "html report",
    "research html",
    "research report",
    "html 리포트",
    "조사 보고서 html",
    "리서치 html",
  ],
  "html-spec-decision-maker": [
    "html spec",
    "html스펙",
    "html 스펙",
    "스펙을 html로",
    "의사결정 html",
    "결정사항 html",
    "결정 워크시트",
    "사전결정 html",
    "decision worksheet",
    "pre-decision html",
    "옵션 비교 html",
    "요구사항 명확화 html",
  ],
  "improve-codebase-architecture": [
    "improve architecture",
    "architecture refactor",
    "deepen modules",
    "refactoring opportunity",
    "아키텍처 개선",
    "구조 개선",
    "리팩토링 기회",
    "모듈 깊게",
  ],
  "large-task-delegation": [
    "큰 작업",
    "large task",
    "multi-file refactor",
    "200+ loc",
    "multi-stage workflow",
    "여러 파일 수정",
  ],
  "memory-discipline": [
    "메모리 규율",
    "기억 저장",
    "retain 정책",
    "recall",
    "cycle end",
    "회고 저장",
  ],
  "pre-commit-gate": [
    "커밋 전 점검",
    "프리커밋 게이트",
    "git commit",
    "git push",
    "gh pr create",
    "commit this",
    "ready to commit",
    "create a pr",
  ],
  "receiving-code-review": [
    "apply review",
    "fix the comments",
    "reviewer said",
    "codex review 결과 반영",
    "리뷰 피드백 적용",
    "리뷰 코멘트 반영",
  ],
  "spec-and-review": [
    "spec 잡자",
    "plan draft",
    "plan 만들어",
    "codex review",
    "cross-vendor review",
    "write a spec",
    "design doc",
    "review the plan",
  ],
  "subagent-driven-development": [
    "execute plan",
    "implement plan",
    "계획 실행해줘",
    "플랜대로 구현",
    "plan execution",
  ],
  "systematic-debugging": [
    "디버깅",
    "왜 깨지지",
    "원인 찾아줘",
    "race condition",
    "regression",
    "test failure",
    "debug this",
    "fix the bug",
    "why is it failing",
    "its broken",
  ],
  "tdd-strict": [
    "tdd",
    "test first",
    "red-green",
    "test driven",
    "write tests first",
    "테스트 먼저",
    "테스트부터",
  ],
  "writing-plans": [
    "plan it",
    "write plan",
    "implementation plan",
    "break it down",
    "계획 세워줘",
    "구현 계획",
    "plan만들어",
  ],
};

export type SkillKeywordIndexEntry = SkillSelectionIndexEntry;

export interface MatchedSkill {
  name: string;
  rawMatchedPhrases: string[];
  ownedReadTarget: string;
  pluginRoot: string;
  phases?: RuntimeSkillPhase[];
  deferred?: boolean;
}

export interface SkillKeywordLoaderState {
  lastUserMessageId: string | null;
  matchedSkills: MatchedSkill[];
  deferredSkillObligations: MatchedSkill[];
  phaseReceipts: Array<{ phase: RuntimeSkillPhase; skill: string; satisfiedAt: string; ownedReadTarget?: string }>;
}

export interface SkillKeywordIndexIssue {
  skillPath: string;
  skillName: string;
  reason: string;
}

export interface SkillKeywordIndexLoadResult {
  index: SkillKeywordIndexEntry[];
  issues: SkillKeywordIndexIssue[];
  shippedSkillCount: number;
}

function normalizeIssueReason(reason: unknown): string {
  const message =
    reason instanceof Error ? reason.message : typeof reason === "string" ? reason : String(reason);
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : "unknown keyword-index failure";
}

export function formatSkillKeywordIndexIssues(
  issues: SkillKeywordIndexIssue[],
  limit = 3
): string {
  const shown = issues
    .slice(0, limit)
    .map((issue) => `${issue.skillName} (${issue.reason})`);
  const remaining = issues.length - shown.length;
  return remaining > 0 ? `${shown.join("; ")}; +${remaining} more` : shown.join("; ");
}


interface BranchEntryLike {
  id?: unknown;
  type?: unknown;
  message?: { role?: unknown; content?: unknown };
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  return Bun.YAML.parse(match[1]) as Record<string, unknown>;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/["'“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function pruneMatchedSkillsForRuntime(
  matchedSkills: MatchedSkill[],
  latestUserText: string
): { rootSkills: MatchedSkill[]; deferredSkillObligations: MatchedSkill[] } {
  const index = matchedSkills.map((skill, manifestOrder) => ({
    ...skill,
    description: "",
    phrases: skill.rawMatchedPhrases,
    manifestOrder,
  }));
  const receipt = selectSkillsForTurn({
    latestUserText,
    index,
    maxImplicitRoots: DEFAULT_MAX_IMPLICIT_ROOTS,
  });

  return {
    rootSkills: [...receipt.explicit, ...receipt.implicitRoot],
    deferredSkillObligations: receipt.deferred,
  };
}

function formatPublicSkillNameDrift(
  expectedName: string,
  actualName: unknown,
  absolutePath: string
): string {
  const renderedActual =
    typeof actualName === "string" && actualName.trim().length > 0
      ? JSON.stringify(actualName.trim())
      : "(missing frontmatter name)";
  return `public skill frontmatter drift at ${absolutePath}: expected ${JSON.stringify(expectedName)}, found ${renderedActual}`;
}

export function matchSkillsForText(
  text: string,
  index: SkillKeywordIndexEntry[]
): MatchedSkill[] {
  const normalizedText = normalizeText(text);
  return index
    .map((entry) => {
      const rawMatchedPhrases = entry.phrases.filter((phrase) =>
        normalizedText.includes(normalizeText(phrase))
      );
      return rawMatchedPhrases.length > 0
        ? {
            name: entry.name,
            rawMatchedPhrases,
            ownedReadTarget: entry.ownedReadTarget,
            pluginRoot: entry.pluginRoot,
          }
        : null;
    })
    .filter((entry): entry is MatchedSkill => entry !== null);
}


export function loadSkillKeywordIndexReport(pluginRoot: string): SkillKeywordIndexLoadResult {
  const resolvedPluginRoot = path.resolve(pluginRoot);
  const pluginPath = path.resolve(resolvedPluginRoot, ".claude-plugin", "plugin.json");
  const plugin = JSON.parse(readFileSync(pluginPath, "utf-8")) as { skills?: unknown };
  const skillPaths = Array.isArray(plugin.skills)
    ? plugin.skills.filter((value): value is string => typeof value === "string")
    : [];

  const index: SkillKeywordIndexEntry[] = [];
  const issues: SkillKeywordIndexIssue[] = [];

  for (const [manifestOrder, skillPath] of skillPaths.entries()) {
    let skillName = skillPath;
    try {
      const surface = resolveShippedSkillSurfaceEntry(resolvedPluginRoot, skillPath);
      skillName = surface.publicSkillName;
      const content = readFileSync(surface.absolutePath, "utf-8");
      const frontmatter = parseFrontmatter(content);
      const frontmatterName =
        typeof frontmatter.name === "string" ? frontmatter.name.trim() : undefined;
      if (frontmatterName !== surface.publicSkillName) {
        issues.push({
          skillPath,
          skillName,
          reason: formatPublicSkillNameDrift(
            surface.publicSkillName,
            frontmatter.name,
            surface.absolutePath
          ),
        });
        continue;
      }

      const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
      const whitelist = SKILL_KEYWORD_WHITELIST[surface.skillName];
      if (!whitelist || whitelist.length === 0) {
        issues.push({ skillPath, skillName, reason: "missing keyword whitelist" });
        continue;
      }

      const seen = new Set<string>();
      const phrases: string[] = [];
      for (const phrase of whitelist) {
        const normalized = normalizeText(phrase);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        phrases.push(phrase);
      }

      index.push({
        name: surface.publicSkillName,
        description,
        phrases,
        ownedReadTarget: surface.ownedReadTarget,
        pluginRoot: surface.pluginRoot,
        manifestOrder,
      });
    } catch (err) {
      issues.push({
        skillPath,
        skillName,
        reason: normalizeIssueReason(err),
      });
    }
  }

  return { index, issues, shippedSkillCount: skillPaths.length };
}

export function loadSkillKeywordIndex(repoRoot: string): SkillKeywordIndexEntry[] {
  return loadSkillKeywordIndexReport(repoRoot).index;
}

export function createSkillKeywordLoaderState(): SkillKeywordLoaderState {
  return {
    lastUserMessageId: null,
    matchedSkills: [],
    deferredSkillObligations: [],
    phaseReceipts: [],
  };
}

export function updateSkillKeywordLoaderOnTurnStart(
  state: SkillKeywordLoaderState,
  branchEntries: BranchEntryLike[],
  index: SkillKeywordIndexEntry[]
): SkillKeywordLoaderState {
  let latestUserId: string | null = null;
  let latestUserText = "";

  for (let i = branchEntries.length - 1; i >= 0; i--) {
    const entry = branchEntries[i];
    if (entry?.type !== "message") continue;
    if (entry.message?.role !== "user") continue;
    if (typeof entry.id !== "string" || entry.id.length === 0) continue;

    latestUserId = entry.id;
    if (typeof entry.message.content === "string") {
      latestUserText = entry.message.content;
    } else if (Array.isArray(entry.message.content)) {
      latestUserText = entry.message.content
        .map((item) => {
          if (typeof item === "string") return item;
          if (
            item &&
            typeof item === "object" &&
            "text" in item &&
            typeof (item as { text?: unknown }).text === "string"
          ) {
            return (item as { text: string }).text;
          }
          return "";
        })
        .join("\n");
    }
    break;
  }

  if (latestUserId === null) return state;
  if (state.lastUserMessageId === latestUserId) return state;

  const receipt = selectSkillsForTurn({
    latestUserText,
    index,
    maxImplicitRoots: DEFAULT_MAX_IMPLICIT_ROOTS,
  });

  return {
    lastUserMessageId: latestUserId,
    matchedSkills: [...receipt.explicit, ...receipt.implicitRoot],
    deferredSkillObligations: receipt.deferred,
    phaseReceipts: [],
  };
}


export function buildKeywordMatchedSkillsPrompt(
  matchedSkills: MatchedSkill[],
  deferredSkillObligations: MatchedSkill[] = []
): string | null {
  if (matchedSkills.length === 0 && deferredSkillObligations.length === 0) return null;

  const activePluginRoots = Array.from(
    new Set([...matchedSkills, ...deferredSkillObligations].map((skill) => skill.pluginRoot))
  );
  const lines = [
    `<!-- ${KEYWORD_SKILL_DEDUP_KEY} -->`,
    "## Runtime keyword-matched skills",
    "",
    "Load only the root skill targets listed below before substantive work. Deferred obligations are exact-read requirements only when their phase boundary is reached.",
    activePluginRoots.length === 1
      ? `Active plugin root: \`${activePluginRoots[0]}\``
      : `Unexpected multiple plugin roots matched in one turn: ${activePluginRoots.map((root) => `\`${root}\``).join(", ")}`,
    "Root skill proof targets:",
    "",
  ];
  for (const skill of matchedSkills) {
    lines.push(
      `- \`${skill.ownedReadTarget}\` — \`${skill.name}\` phases=${(skill.phases ?? []).join(",") || "all"}`
    );
  }
  if (deferredSkillObligations.length > 0) {
    lines.push("", "Deferred obligations:");
    for (const skill of deferredSkillObligations) {
      lines.push(
        `- \`${skill.ownedReadTarget}\` — \`${skill.name}\` before phases=${(skill.phases ?? []).join(",") || "mutate,verify"}`
      );
    }
  }
  if (getCapabilitiesByTag("deep-interview").includes("ask")) {
    lines.push(
      "",
      "### Native deep-interview routing",
      "- When ambiguity or a user-owned decision remains, route it through `pi-oven_ask`.",
      "- Supply structured `deepInterview` metadata so topology confirmation, milestone bands, weakest-target selection, threshold tracking, spec persistence, approval handoff, and resume state persist in the native runtime."
    );
  }
  return lines.join("\n");
}
