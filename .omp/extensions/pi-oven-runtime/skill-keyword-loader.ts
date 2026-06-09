import { readFileSync } from "fs";
import * as path from "path";

export const PI_OVEN_SKILL_NS = "pi-oven";
export const KEYWORD_SKILL_DEDUP_KEY = "pi-oven:keyword-skills@v1";
const MAX_MATCHED_SKILLS = 8;

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

export interface SkillKeywordIndexEntry {
  name: string;
  description: string;
  phrases: string[];
}

export interface MatchedSkill {
  name: string;
  matchedPhrases: string[];
}

export interface SkillKeywordLoaderState {
  lastUserMessageId: string | null;
  matchedSkills: MatchedSkill[];
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

export function matchSkillsForText(
  text: string,
  index: SkillKeywordIndexEntry[]
): MatchedSkill[] {
  const normalizedText = normalizeText(text);
  return index
    .map((entry) => {
      const matchedPhrases = entry.phrases.filter((phrase) =>
        normalizedText.includes(normalizeText(phrase))
      );
      return matchedPhrases.length > 0 ? { name: entry.name, matchedPhrases } : null;
    })
    .filter((entry): entry is MatchedSkill => entry !== null)
    .slice(0, MAX_MATCHED_SKILLS);
}


export function loadSkillKeywordIndex(repoRoot: string): SkillKeywordIndexEntry[] {
  const pluginPath = path.resolve(repoRoot, ".claude-plugin", "plugin.json");
  const plugin = JSON.parse(readFileSync(pluginPath, "utf-8")) as { skills?: unknown };
  const skillPaths = Array.isArray(plugin.skills)
    ? plugin.skills.filter((value): value is string => typeof value === "string")
    : [];

  return skillPaths.map((skillPath) => {
    const absolute = path.resolve(repoRoot, skillPath);
    const content = readFileSync(absolute, "utf-8");
    const frontmatter = parseFrontmatter(content);
    const name =
      typeof frontmatter.name === "string" ? frontmatter.name : path.basename(path.dirname(absolute));
    const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
    const whitelist = SKILL_KEYWORD_WHITELIST[name];
    if (!whitelist || whitelist.length === 0) {
      throw new Error(`Missing keyword whitelist for shipped skill: ${name}`);
    }

    const seen = new Set<string>();
    const phrases: string[] = [];
    for (const phrase of whitelist) {
      const normalized = normalizeText(phrase);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      phrases.push(phrase);
    }

    return { name, description, phrases };
  });
}

export function createSkillKeywordLoaderState(): SkillKeywordLoaderState {
  return { lastUserMessageId: null, matchedSkills: [] };
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

  const matchedSkills = matchSkillsForText(latestUserText, index);

  return { lastUserMessageId: latestUserId, matchedSkills };
}

export function buildKeywordMatchedSkillsPrompt(matchedSkills: MatchedSkill[]): string | null {
  if (matchedSkills.length === 0) return null;

  const lines = [
    `<!-- ${KEYWORD_SKILL_DEDUP_KEY} -->`,
    "## Runtime keyword-matched skills",
    "",
    "The latest user message matched these pi-oven skills from the curated keyword whitelist.",
    `You MUST load each listed skill with \`read("skill://pi-oven:<name>")\` before taking substantive action in this turn.`,
    "This is a hard precondition, NOT a suggestion: do not begin any skill-governed work until the matching skill is loaded and followed.",
    "Preserve all non-conflicting rules across the matched skills. If two skills conflict, prefer the more specific one.",
    "",
  ];
  for (const skill of matchedSkills) {
    lines.push(`- \`skill://${PI_OVEN_SKILL_NS}:${skill.name}\` — matched by: ${skill.matchedPhrases.join(", ")}`);
  }
  return lines.join("\n");
}
