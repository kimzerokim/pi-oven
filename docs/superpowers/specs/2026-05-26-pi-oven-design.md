# pi-oven — Design Spec (SUPERSEDED 2026-05-27)

> **STATUS: SUPERSEDED.** 이 문서는 2026-05-26 의 "Thin Bundle + Adapter" 접근법.
> 2026-05-27 에 방향 전환 — adapter 대신 omp-native 스킬 셋을 새로 작성. 새 spec
> 작성 후 path 를 여기에 링크. history 보존 목적으로 본문 유지.

- **Status:** SUPERSEDED
- **Date:** 2026-05-26 (superseded 2026-05-27)
- **Author:** kimzerokim
- **Repo:** github.com/kimzerokim/pi-oven
- **Upstreams tracked:** github.com/can1357/oh-my-pi (`omp`), github.com/kimzerokim/pi-oven

---

## 1. Problem & Goal

기존 `pi-oven` 는 Claude Code 전용 마크다운 스킬 레이어. 18개 `pi-oven-*` SKILL.md + `harness-share.md` + `keyword-detector.mjs` UserPromptSubmit hook 으로 commit gate / autonomous boundary / Playwright verification / large task delegation 등을 강제한다.

`oh-my-pi (omp)` 는 멀티 런타임 (Python eval, Bun worker, Bash PTY, browser, debugger) + 40+ 모델 프로바이더 + TypeScript plugin 모델을 가진 강력한 코딩 에이전트. 단 자체 워크플로우 규율은 얕다.

**목표:** 두 자산을 합쳐, 다른 사람이 자기 머신에서 *한 번에* 설치하면 omp 런타임 위에서 pi-oven 워크플로우가 그대로 동작하도록 만든다. 글로벌/프로젝트 두 모드, 재현 가능, pi-oven 와 omp 양쪽 upstream 버전업에 대응.

## 2. Non-goals

- omp 또는 pi-oven 의 fork. 둘 다 upstream 을 추적, 본체에는 손대지 않는다.
- Claude Code 와의 호환 종료. Claude Code 사용자는 계속 `pi-oven` 자체를 쓰면 된다. `pi-oven` 는 omp 쪽 distro.
- 18개 스킬을 TypeScript 로 재구현. 마크다운 본문은 그대로 두고 adapter 만 얹는다.
- Windows 일급 지원 (v1). darwin/linux × arm64/x64 만 enforce.
- 자동 업데이트 (cron / launch-time auto-check). 재현성 위해 명시적 `update` 만.

## 3. Approach summary

**선택된 접근법: Thin Bundle + omp Adapter Plugin** (brainstorming 단계 옵션 B).

세 컴포넌트:
1. **pi-oven (이 repo)** — orchestrator. `install.sh`, `update.sh`, `uninstall.sh`, `pi-oven` CLI. 자체 비즈니스 로직 0.
2. **`@pi-oven/pi-omp-adapter`** (TypeScript) — omp 가 로드하는 plugin. pi-oven SKILL.md 가 호출하는 Claude-side primitive (codex shell, CRG MCP, Playwright MCP) 를 omp-native 로 forward.
3. **pi-oven 스킬 본체** — `github.com/kimzerokim/pi-oven` 에서 매 install/update 마다 fetch. 우리는 절대 수정하지 않는다.

## 4. Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                  사용자 머신 (macOS / Linux)                    │
│                                                                │
│  ┌──────────────────┐   ┌────────────────────────────────────┐│
│  │  pi-oven          │   │  oh-my-pi runtime                  ││
│  │  (orchestrator)  │   │  (@oh-my-pi/pi-coding-agent)       ││
│  │                  │   │                                    ││
│  │  install.sh      │──▶│  ┌──────────────────────────────┐  ││
│  │  update.sh       │   │  │  @pi-oven/pi-omp-adapter (TS)     │ ││
│  │  uninstall.sh    │   │  │  · codexReview tool          │  ││
│  │  bin/pi-oven      │   │  │  · crgQuery tool             │  ││
│  └──────────────────┘   │  │  · playwrightVerify tool     │  ││
│                         │  │  · piOvenKeywordHook            │  ││
│                         │  └──────────────────────────────┘  ││
│  fetch from   ──────────▶  ┌──────────────────────────────┐  ││
│  github.com/             │  │  pi-oven-* SKILL.md (18개)        │  ││
│  kimzerokim/             │  │  harness-share.md             │  ││
│  pi-oven             │  │  CLAUDE.md (routing block)    │  ││
│                         │  └──────────────────────────────┘  ││
│                         │                                    ││
│                         │  providers: ChatGPT-sub → opencode │ │
│                         │             zen 폴백 (필수)         ││
│                         └────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────┘
```

**불변 식 (invariants)**
- pi-oven SKILL.md 는 우리가 수정하지 않는다. 어댑터가 Claude-side primitive 를 가로채 omp-native 로 매핑한다.
- omp upstream 변경 → 어댑터만 패치. pi-oven upstream 변경 → seed 스크립트만 다시 fetch.
- install 은 사용자 영역 (`~/.config/omp/`, `~/.config/pi-oven/`, `~/.cache/pi-oven/`) 또는 명시된 project root 바깥에 절대 쓰지 않는다.

## 5. Install Flow

### 5.1 Entrypoints (3 가지)

| 방식 | 트리거 | 권장 |
|---|---|---|
| **1. AI Prompt 복붙** | Claude Code / Codex / omp 안에서 `docs/install/prompt-*.md` 의 prompt 붙여넣기 | ✅ 권장 — 인터랙티브 + 실패 진단 + 일관성 |
| **2. Terminal curl** | `curl -fsSL .../install.sh \| sh -s -- --global` | ⚠️ CI/Docker 자동화용. 사용자는 비권장 |
| **3. `pi-oven` CLI** | 1회 설치 후 `pi-oven update`/`status`/`uninstall` | 재실행/관리 표면 |

`docs/install/` 에 세 환경별 prompt 파일을 둔다 — `prompt-claude-code.md`, `prompt-codex.md`, `prompt-pi.md`. 핵심 절차는 동일, 환경별 phrasing/tool 만 다름.

### 5.2 Phases (idempotent, --resume 지원)

| # | Phase | 동작 | Hard-fail 조건 |
|---|---|---|---|
| 0 | Preflight | OS/arch 확인, mode 결정 (`--global` vs `--project`), bun/node20+ 감지 (없으면 bun curl install) | 미지원 OS, project mode 인데 cwd 가 project root 아님 |
| 1 | omp install/upgrade | `omp --version` 비교. 없으면 `curl -fsSL https://omp.sh/install \| sh`. 핀한 최소 버전보다 낮으면 upgrade (사용자 confirm 1회) | omp 인스톨러 실패 |
| 2 | pi-oven seed | `git clone --depth 1 https://github.com/kimzerokim/pi-oven.git /tmp/pi-oven-pull/`. SKILL.md 의 frontmatter `version:` per-file 비교 후 overwrite/preserve. source 에 없는 local `pi-oven-*` 는 묶어서 confirm 후 삭제. `harness-share.md` 는 unconditional overwrite | clone 실패, write 권한 없음 |
| 3 | Adapter install | `bun install -g @pi-oven/pi-omp-adapter@latest`. omp plugin manifest 등록. `omp /reload-plugins` | npm install 실패, omp plugin reload 실패 |
| 4 | CRG install (**mandatory**) | `pipx install code-review-graph` → 실패시 `pip install --user code-review-graph` → `code-review-graph --version` PATH 확인 | 둘 다 실패시 abort + Python/pipx 안내 |
| 5 | Provider 설정 | ChatGPT subscription token + opencode zen API key 입력 받아 omp config 에 등록 (두 provider 모두 필수) | 사용자가 입력 거부 |
| 6 | Sanity check | `omp -p "pi-oven routing OK?"` 1-shot 으로 CLAUDE.md routing block 주입 확인. `omp --tool-list \| grep -E "codexReview\|crgQuery"` 어댑터 tool 노출 확인 | routing block 누락, 어댑터 tool 미노출 |

**State 파일:** `~/.cache/pi-oven/installer.json` 에 마지막 성공 phase + SHA/version 기록. `pi-oven install --resume` 으로 재개.

### 5.3 Mode-specific write paths

| 자산 | `--global` | `--project` |
|---|---|---|
| omp 본체 | `~/.bun/bin/omp` (omp 인스톨러 결정) | 동일 (omp 는 항상 글로벌) |
| pi-oven SKILL.md | `~/.config/omp/skills/pi-oven-*/` | `<proj>/.omp/skills/pi-oven-*/` |
| harness-share.md | `~/.config/omp/.pi-oven-shared/harness-share.md` | `<proj>/.omp/.pi-oven-shared/harness-share.md` |
| routing block | `~/.claude/CLAUDE.md` marker block (omp 가 auto-discover) | `<proj>/CLAUDE.md` marker block |
| routing block (secondary) | `~/.config/omp/AGENTS.md` marker block (omp-only 환경) | `<proj>/.omp/AGENTS.md` marker block |
| adapter pkg | `bun install -g` (글로벌 npm prefix) | 동일 (어댑터는 항상 글로벌) |
| adapter config | `~/.config/pi-oven/adapter.json` | `<proj>/.omp/pi-oven/adapter.json` (글로벌 base 위에 deep merge) |
| CRG bin | pipx user dir (글로벌) | 동일 |
| CRG index | n/a (`--skip-project`) | `<proj>/.code-review-graph/` (lazy build) |
| project artifacts | n/a | `<proj>/` (harness-flow-progress.md, docs/harness/, etc.) |
| installer state | `~/.cache/pi-oven/state.json` | `<proj>/.omp/pi-oven/state.json` |

**모드 결정**
- `--global` (기본): cwd 무관. 모든 omp 세션에서 자동 활성.
- `--project`: cwd 가 git repo OR CLAUDE.md/AGENTS.md 보유 → abort otherwise.
- **공존:** 글로벌 + 특정 프로젝트 project mode 둘 다 가능. omp 의 project-over-global layering 활용 → project 가 우선.

## 6. Update Flow

### 6.1 매트릭스

| 컴포넌트 | 어디서 | 판정 | 동작 |
|---|---|---|---|
| `install.sh` 자체 | 이 repo main | 매 update 마다 latest fetch → self-replace | re-exec |
| oh-my-pi | omp.sh/install 또는 bun | `omp --version` vs 핀한 minimum | 사용자 confirm 1회 후 upgrade |
| pi-oven 스킬 | `kimzerokim/pi-oven` | per-file frontmatter `version:` | source ≥ local 면 overwrite, local > source 면 preserve + 로그 |
| harness-share.md | 같은 repo | SoT 1개 | unconditional overwrite |
| `@pi-oven/pi-omp-adapter` | npm latest | `bun pm ls` vs registry | 다르면 upgrade |
| CRG | PyPI latest | `pipx upgrade` 또는 `pip install -U --user` | latest 로 고정 |
| routing block | 우리 generator | 매번 regenerate | marker 안쪽만, 밖은 byte-for-byte 보존 |

### 6.2 정책

- **Drift 정리:** source 에 없는 `pi-oven-*` 디렉토리는 묶어서 사용자 confirm 후 삭제. silent delete 금지.
- **Adapter major bump:** `@pi-oven/pi-omp-adapter` major version 차이 발생 시 install/update 가 `install/lib/compat.json` 의 호환 매트릭스로 enforce. mismatch 면 부분 update 차단 + "양쪽 같이 update" 안내.
- **Dry-run:** `--dry-run` 으로 어떤 파일이 overwrite/preserve/delete 될지 사전 출력.
- **자동 업데이트 없음.** `pi-oven status` 가 nudge 만.

### 6.3 Uninstall

- `pi-oven uninstall` 또는 `bash ~/.config/pi-oven/install/uninstall.sh`.
- `~/.config/omp/skills/pi-oven-*/`, `~/.config/omp/.pi-oven-shared/`, adapter npm, routing block 제거.
- omp 본체 + CRG 는 자동 제거 X (다른 도구 공유 가능). 안내만.
- `--purge-project-artifacts <path>` 옵션으로 특정 repo 의 `docs/harness/`, `.omc/`, `harness-flow-progress.md` 까지 정리.

## 7. Adapter API — `@pi-oven/pi-omp-adapter`

omp plugin 으로 작성. 4 책임만.

### 7.1 파일 레이아웃

```
packages/omp-adapter/
├── package.json         # name: "@pi-oven/pi-omp-adapter", omp peer-dep range
├── src/
│   ├── index.ts         # plugin entry — defineExtension({ tools, hooks })
│   ├── codexReview.ts
│   ├── crgQuery.ts
│   ├── playwrightVerify.ts
│   ├── piOvenKeywordHook.ts
│   ├── providers.ts     # ChatGPT-sub / opencode-zen 폴백 디스패치
│   └── config.ts        # ~/.config/pi-oven/adapter.json 로드
└── tests/
```

### 7.2 `codexReview` tool

```typescript
type CodexReviewInput = {
  spec: string;
  reviewType: 'plan' | 'spec' | 'design';
  scopeHint?: string;
};
type CodexReviewOutput = {
  verdict: 'PASS' | 'CONTINUE' | 'HALT';
  blockers: string[];   // 🔴
  nits: string[];       // 🟡
  pushbacks: string[];  // ⚪
  rawText: string;
  providerUsed: 'chatgpt-sub' | 'opencode-zen';
};
```

디스패치 순서:
1. ChatGPT subscription provider 가 omp config 에 등록 + token 유효 → 1차 호출
2. 401 / 429 / network / not configured → opencode zen 로 폴백 (필수)
3. 둘 다 실패 → `verdict: 'HALT'` + 에러 메시지 (spec-and-review 가 자체 HALT 처리)

### 7.3 `crgQuery` tool

```typescript
type CrgQueryInput = {
  query: 'symbol' | 'reverseRefs' | 'pathSearch';
  args: Record<string, unknown>;
  forceRefresh?: boolean;
};
type CrgQueryOutput = {
  rows: unknown[];
  truncated: boolean;
  indexFreshness: {
    status: 'fresh' | 'rebuilt-sha' | 'rebuilt-dirty' | 'rebuilt-ttl' | 'rebuilt-forced';
    indexedSha: string;
    indexedAt: string;
    rebuildTookMs?: number;
  };
};
```

매 호출 전 freshness 게이트:
1. 인덱스 부재 → full build (`code-review-graph index .`)
2. `manifest.json.last_indexed_sha` vs `git rev-parse HEAD` 다르면 → STALE → incremental rebuild (CRG 미지원 시 full)
3. `git status --porcelain` dirty 파일이 query path 와 겹치면 → STALE → incremental
4. `last_indexed_at` > 7일 (`PI_OVEN_CRG_TTL_DAYS` override) → STALE → rebuild
5. `forceRefresh: true` → 위 셋 skip, 무조건 rebuild

**stale 인덱스 위에서 query 절대 금지.** rebuild 실패시 tool error 리턴 → caller 가 결정 (v1.17.0+ 정책상 `PI_OVEN_CRG_GREP_FALLBACK=1` 없으면 grep fallback 도 금지).

Rebuild progress 는 stderr 로 stream (omp tool progress 채널).

### 7.4 `playwrightVerify` tool

```typescript
type PlaywrightVerifyInput = {
  pages: { url: string; selector?: string }[];
  consoleErrorTolerance: number;  // default 0
  screenshot: 'full' | 'viewport' | 'none';
};
type PlaywrightVerifyOutput = {
  passed: boolean;
  screenshots: string[];
  consoleErrors: { url: string; msg: string }[];
};
```

내부적으로 omp 내장 browser tool (`browser.navigate`, `browser.screenshot`, `browser.console_messages`) 호출. Gate 4 의 3+ pages / 0 console error 조건 enforce.

### 7.5 `piOvenKeywordHook` (message-pre hook)

omp hook API 에 등록 → `keyword-detector.mjs` 의 9 RULES 동일 정규식 매칭 → 매치되면 system message 로 forced injection (`🚨 [pi-oven] LOAD before edit: <skill> (matched: '<phrase>')`).

**omp 가 message-pre hook 미지원 시 v1 폴백:** slash command `/pi-oven on` / `/pi-oven auto` 로 대체. install 시 omp 버전 확인 후 분기.

### 7.6 Config

`~/.config/pi-oven/adapter.json`:
```json
{
  "providers": {
    "chatgptSubscription": { "tokenEnv": "CHATGPT_SUB_TOKEN" },
    "opencodeZen": { "apiKeyEnv": "OPENCODE_ZEN_API_KEY" }
  },
  "crg": { "binPath": "~/.local/bin/code-review-graph", "ttlDays": 7 },
  "keywordHook": { "enabled": true },
  "logLevel": "info"
}
```

Project mode 는 `<proj>/.omp/pi-oven/adapter.json` 에 partial override → 글로벌 base 위에 deep merge.

## 8. Naming & Distribution

| 자산 | 확정값 |
|---|---|
| 로컬 디렉토리 | `~/work/personal/pi-oven/` |
| GitHub repo | `kimzerokim/pi-oven` |
| Install CLI | `pi-oven` |
| 배포 패키지 (npm, 있다면) | `pi-oven` (unscoped) |
| Adapter npm pkg | `@pi-oven/pi-omp-adapter` |
| Marker block | `<!-- pi-oven:start --> ... <!-- pi-oven:end -->` |
| Cache / config dir | `~/.cache/pi-oven/`, `~/.config/pi-oven/` |

curl one-liner:
```
curl -fsSL https://raw.githubusercontent.com/kimzerokim/pi-oven/main/install.sh \
  | sh -s -- --global
```

### 8.1 `pi-oven` CLI 표면

```
pi-oven install   [--global|--project] [--resume] [--dry-run]
pi-oven update    [--scope global|project|all] [--dry-run]
pi-oven uninstall [--scope ...] [--purge-project-artifacts <path>]
pi-oven status                                     # 컴포넌트 버전 + drift 진단
pi-oven doctor                                     # provider/CRG/omp 헬스체크
```

## 9. Repo Layout

```
pi-oven/
├── README.md
├── CLAUDE.md                       # distribution + dogfood SoT (§10)
├── install.sh                      # curl one-liner 진입점
├── update.sh                       # → install.sh --update
├── uninstall.sh
├── docs/
│   ├── install/
│   │   ├── prompt-claude-code.md   # AI prompt 복붙 (권장)
│   │   ├── prompt-codex.md
│   │   └── prompt-pi.md
│   ├── superpowers/specs/          # 이 design doc 위치
│   ├── harness/                    # self-dogfood 산출물
│   └── plans/
├── install/
│   ├── lib/
│   │   ├── seed-skills.sh          # Phase 2
│   │   ├── install-omp.sh          # Phase 1
│   │   ├── install-adapter.sh      # Phase 3
│   │   ├── install-crg.sh          # Phase 4 (mandatory)
│   │   ├── setup-providers.sh      # Phase 5
│   │   ├── sanity-check.sh         # Phase 6
│   │   ├── render-routing-block.sh # marker block 생성기
│   │   └── compat.json             # adapter ↔ skill 호환 매트릭스
│   ├── bin/
│   │   └── pi-oven                  # post-install CLI 진입점
│   └── templates/
│       └── routing-block.md        # marker 블록 템플릿
├── packages/
│   └── omp-adapter/                # @pi-oven/pi-omp-adapter
│       ├── package.json
│       ├── src/
│       └── tests/
├── tests/
│   ├── install-flow.bats           # bats-core
│   ├── update-flow.bats
│   └── adapter/                    # vitest
├── .github/workflows/
│   ├── adapter-ci.yml
│   └── installer-ci.yml
├── CHANGELOG.md
└── LICENSE
```

## 10. Repo 루트 CLAUDE.md (dogfood + 배포 SoT)

**이중 목적**
- 이 repo 에서 Claude Code 가 열리면 → dogfood 워크플로우 활성
- `pi-oven install` 이 사용자 머신에 배포하는 *canonical CLAUDE.md* — 별도 template 없음

**install 시 분기**
- 사용자 머신에 `~/.claude/CLAUDE.md` 또는 `<proj>/CLAUDE.md` **없음** → 우리 CLAUDE.md 그대로 복사
- **있음** → marker 블록만 추출해 사용자 파일에 append/refresh. marker 바깥 영역 byte-for-byte 보존

**파일 헤더 (배포 명시)**

```markdown
# pi-oven — Distribution CLAUDE.md

> 이 파일은 pi-oven 의 _distribution CLAUDE.md_ 입니다.
> - 이 repo (github.com/kimzerokim/pi-oven) 안에서 Claude Code 가 열면 dogfood 워크플로우로 작동
> - `pi-oven install` 이 사용자 머신에 배포할 때도 이 파일이 SoT — 별도 template 없음
> - marker 블록 (<!-- pi-oven:start ... end -->) 만이 사용자 CLAUDE.md 와 합쳐지는 부분
> - marker 바깥 영역은 dogfood 전용
```

**marker 블록 내용**
- 활성 `pi-oven-*` 스킬 표 (이름 + trigger keywords) — pi-oven install 패턴 재사용
- `harness-share.md` 위치 안내
- `@pi-oven/pi-omp-adapter` 가 제공하는 tool 이름 (`codexReview`, `crgQuery`, `playwrightVerify`)
- "more: github.com/kimzerokim/pi-oven"

**dogfood 영역**
- install.sh 수정시 `tests/install-flow.bats` 통과 필수
- adapter 변경시 `packages/omp-adapter/` 에서 `bun test` 통과 필수
- 새 `pi-oven-*` 스킬은 upstream (`kimzerokim/pi-oven`) 에 PR — 이 repo 는 자체 스킬 보관 X

**Update 시 marker 동작**
- `pi-oven update` 가 사용자 머신의 marker 안쪽만 regenerate. 사용자가 marker 안에 수동 추가한 내용은 다음 update 에 사라짐 (명시적 룰).
- marker 밖에 적은 건 영영 보존.
- marker 자체가 지워져 있으면 "다시 만들까?" confirm 후 추가.

## 11. Versioning

- `install.sh` / `pi-oven` CLI: SemVer. 이 repo 의 git tag (`v1.0.0`).
- `@pi-oven/pi-omp-adapter`: 독립 SemVer. npm tag + git tag.
- 호환 매트릭스: `install/lib/compat.json`.
- pi-oven 와 omp 는 우리가 핀하지 않음 — 항상 latest fetch. minimum 만 enforce (`install/lib/min-versions.json` — v1 release 시점에 검증된 floor 만 박음, 이후 release 마다 raise).

## 12. Testing strategy

- **Installer (bats-core):** `tests/install-flow.bats`, `tests/update-flow.bats`. macOS + Linux GitHub runners. 시나리오: fresh global, fresh project, resume after Phase 4 fail, drift cleanup, dry-run.
- **Adapter (vitest):** `packages/omp-adapter/tests/` unit + integ. provider 폴백 (chatgpt-sub 401 → opencode-zen), CRG freshness gate 5 분기, keyword hook 9 RULES 매칭.
- **End-to-end smoke:** GitHub Actions 가 매 release tag 마다 install → `omp -p` 한 줄 → tool list 확인.

## 13. Verification / Open questions

구현 시 1순위로 확인할 항목 (현재 design 의 가정):

1. **omp 의 plugin manifest 경로 + `defineExtension` 시그니처** — `packages/coding-agent/DEVELOPMENT.md` 확인. 어댑터 entry shape 가 위 가정과 다를 수 있음.
2. **omp 가 `.claude/skills/SKILL.md` 를 시스템 프롬프트에 자동 주입하는지** — auto-discovery 가 config 만 읽는지 skill 본문도 읽는지 불확실. 안 한다면 어댑터가 `loadSkillsFromDir(...)` 로 명시 로드.
3. **message-pre hook 지원 여부** — 없으면 keyword forced injection 은 slash command 로 폴백.
4. **omp 의 provider fallback API** — 자체 retry/fallback 지원하면 `providers.ts` 단순화.
5. **opencode zen 의 정확한 API endpoint + auth shape** — 어댑터의 provider impl 에 필요.
6. **ChatGPT subscription 을 omp 가 어떤 이름의 provider 로 노출하는지** — omp coding plans 항목 확인.

## 14. Out of scope (future)

- Windows 일급 지원
- cursor / windsurf 등 추가 호환 target
- 자동 업데이트 (cron / launch-time check)
- 18 스킬 TS 재구현 (Approach C)
- Telemetry / 익명 사용 통계

---

**End of spec.**
