# Spec E: pi-oven user-local agent override (옵션 B)

**Status**: Draft v1 — 2026-05-29 (cycle 1, 사용자 구조 문제 제기에 대응)
**Scope**: 사용자별 agent customization 이 repo git tree 와 분리되도록 user-local override directory 지원.
**Spec A 의존**: `docs/specs/2026-05-28-pi-oven-agent-registry.md` (23 ROLES 정의 + lint-agents SoT 정합)
**Spec B 의존**: `docs/specs/2026-05-28-pi-oven-setup-wizard.md` (profile + agent rewrite)
**Out-of-scope**: profiles.ts / PROFILE_A/B 정의 자체 (Spec A/B 그대로), omp 의 agent discovery 동작 변경 (필요 시 별도 upstream PR).

---

## §1 Goal

현재 구조에서 사용자가 자기 환경에서 agent model 을 바꾸려면 repo 의 `agents/pi-oven-*.md` 의 frontmatter `model:` 배열을 직접 수정해야 한다. lint-agents.ts 가 profiles.ts PROFILE_A 와 정합을 강제하므로:

- 사용자 변경 → CI lint fail
- 사용자 PR 만들면 본인 customization 이 diff 에 포함
- default 모델 한 번 바뀔 때마다 (예: 2026-05-29 Opus 4.7 → 4.8) 23 agent file 다 rewrite + commit. 잦은 release-noise commit 발생

**목표**: repo agent file = canonical default state, 사용자 customization 은 user-local override directory 에서 처리. repo state 무변경.

---

## §2 진단

### §2.1 현재 SoT chain

```
profiles.ts (PROFILE_A SoT)
   │ /pi-oven:setup --apply
   ▼
agents/pi-oven-*.md (frontmatter model:)
   │
   ▼  (omp 의 task/discovery.ts → frontmatter parse)
omp agent dispatch
```

문제: 사용자 customization 진입점이 agent file frontmatter rewrite 뿐. `omp plugin config set pi-oven.models.<role>.primary <X>` 는 plugin config 만 갱신 — omp agent dispatch 가 frontmatter 만 읽으므로 effect 없음.

### §2.2 omp discovery 의 multi-path 지원 확인

`src/discovery/agents-md.ts` (omp upstream, 2026-05 시점 inspection):
- skills / rules / prompts / commands / AGENTS.md / SYSTEM.md 모두 **project walk-up + user home** 두 source 에서 load.
- helper: `getProjectPathCandidates(ctx, ...)` + `getUserPathCandidates(ctx, ...)`.
- path prefix: `.agent/<segments>` 과 `.agents/<segments>` 양쪽 지원.

→ omp 의 다른 artifact (skill 등) 는 user-local override 가 이미 지원. subagent (agent file) 가 동일 패턴이면 옵션 B 가능.

**미확인**: agent file (subagent) discovery 의 정확한 path candidate 목록. `src/task/discovery.ts` 가 agent file 을 어디서 load 하는지 정확한 grep 필요 (다음 cycle).

---

## §3 옵션 B 정의 — User-local override directory

### §3.1 user-local override path 후보 (omp upstream 정합 시)

| 후보 | 우선순위 | 비고 |
|---|---|---|
| `~/.agent/subagents/pi-oven-<role>.md` | 사용자 home 의 single-segment | `.agent/skills/` 와 정합 |
| `~/.agents/subagents/pi-oven-<role>.md` | alt singular/plural | omp 가 둘 다 지원 |
| `~/.omp/plugins/cache/.../agents/pi-oven-<role>.md` | install cache 내부 | 이미 omp install path — 사용자 직접 수정 시 plugin upgrade 로 덮어씀 (안 좋음) |
| `~/.omp/plugins/pi-oven-overrides/pi-oven-<role>.md` | 신규 plugin-specific user dir | omp upstream 의 별도 hook 필요 |

**권고**: 후보 1 또는 2 (omp 의 기존 user-home walk-up 패턴 재사용). 단, omp 가 subagent 에 대해 이 path 를 실제로 load 하는지 별도 검증 필요.

### §3.2 우선순위 규칙

`pi-oven-<role>` agent 가 dispatch 될 때 path 우선순위:

1. **user-local override**: `~/.agent/subagents/pi-oven-<role>.md` (있으면)
2. **project repo**: `<project>/agents/pi-oven-<role>.md` (Spec A SoT)
3. **plugin install cache**: `~/.omp/plugins/cache/plugins/pi-oven___pi-oven___<v>/agents/pi-oven-<role>.md`

user override 가 있으면 그 frontmatter 의 `model:` 이 actual model. repo 의 default 와 다를 수 있고 그게 의도.

### §3.3 lint-agents.ts 영향

현재 lint 는 `agents/pi-oven-*.md` 의 frontmatter 가 PROFILE_A 와 정합인지만 검증. user override file 은 lint 대상 외 (자율 customization 영역). repo state 만 default 정합 유지 → lint 정책 무변경.

---

## §4 `/pi-oven:setup` 통합

`/pi-oven:setup --apply` 의 동작 옵션:

| 옵션 | 동작 | 장단점 |
|---|---|---|
| (a) repo agent file rewrite (현행) | profile 선택 → 23 agents/pi-oven-*.md 의 frontmatter 직접 rewrite | dirty git tree, PR diff noise |
| (b) user-local override 생성 | profile 선택 → `~/.agent/subagents/pi-oven-<role>.md` 만 생성 (repo 무변경) | clean git tree, user-local 만 effect |
| (c) 양자택일 — `--target=repo` 와 `--target=user-local` | 사용자가 위치 선택 | 유연 |

**권고**: (c) 양자택일. default = user-local. `--target=repo` 는 maintainer 용 (PROFILE_A 정의 변경 시).

### §4.1 wizard 흐름 변경

기존 Spec B §6 Step d 의 confirm + persist:

```
Ready to persist to omp plugin config and rewrite agent files. Proceed? [Y/n]:
```

→ Spec E 후 변경:

```
Apply target?
  [u] user-local override (~/.agent/subagents/pi-oven-*.md) — clean repo, personal only  (default)
  [r] repo agent files (agents/pi-oven-*.md) — for maintainers updating PROFILE_A
Enter [u]:
```

---

## §5 default model 변경 시 commit 흐름

Spec E 후 흐름:

| 시나리오 | repo commit | user-local effect |
|---|---|---|
| User changes own model (e.g. critic = opus 4.8) | none | `~/.agent/subagents/pi-oven-critic.md` 만 update |
| PROFILE_A maintainer updates default (Opus 4.7 → 4.8 release) | 1 commit: profiles.ts + 4 agent file + spec doc | user-local override 의 effect 보존 |
| User wants to drop personal override and return to default | none (delete user-local file) | repo default 가 active |

**결과**: 잦은 release-noise commit 사라짐. maintainer commit 만 남음 (당연 — 큰 버전 범프 = 의도적).

---

## §6 Acceptance Criteria

**AC#1**: omp 의 task/discovery.ts (subagent discovery) 가 `~/.agent/subagents/` 또는 `~/.agents/subagents/` path 를 실제로 candidate 로 load 하는지 검증 (소스 코드 grep). 미지원 시 omp upstream PR 필요.

**AC#2**: `/pi-oven:setup --target=user-local` 명령 추가 — repo agent file 무변경, `~/.agent/subagents/pi-oven-<role>.md` 만 생성/update.

**AC#3**: omp session 에서 user-local override 가 있는 role 의 active model 이 user-local frontmatter 의 model 과 일치 (smoke ping 검증).

**AC#4**: `/pi-oven:setup --status` 가 active resolution chain 표시 (user-local / repo / install cache 중 어느 source 인지).

**AC#5**: lint-agents.ts 가 user-local override file 은 검사 안 함 (lint 대상 = repo `agents/` 만 유지).

---

## §7 Open Questions

### §7.1 omp 의 subagent discovery path 정확한 list

skills 는 `.agent/skills/` + user home walk-up. subagent 도 동일한지? `src/task/discovery.ts` 내부 inspection 필요. 미지원 시 옵션 B 실행 불가 → 옵션 A (extension dispatch hook) 로 우회.

### §7.2 override scope (per-role vs per-profile)

- per-role override: `~/.agent/subagents/pi-oven-<role>.md` — 한 role 만 override
- per-profile override: `~/.agent/pi-oven/profile.json` — 전체 profile 변경 (PROFILE_A 와 별도)
- 둘 다 지원?

권고: 단순성 위해 per-role 만. 사용자가 여러 role 바꾸려면 여러 file 생성.

### §7.3 lint-agents 정책

lint 가 repo `agents/` 만 검사하는 게 default. 다만 user-local 도 ROLES 안에 있는 role 명 사용해야 함 (lint:skills 와 동일 invariant). user-local lint 옵션 추가? 또는 omp runtime 의 ALLOWED_PREFIXES 만 검증?

### §7.4 user-local override 와 plugin config 의 관계

기존 Spec B 는 `omp plugin config set pi-oven pi-oven.models.<role>.primary <X>` 도 supported routing entry. plugin config 와 user-local override 가 둘 다 있으면 어느 게 우선?

권고: user-local override > plugin config > repo default. plugin config 는 wizard state, user-local 은 actual override.

### §7.5 Spec B `--reapply` 의 의미 재정의

Spec B `--reapply` = repo agent file 을 plugin config 기준으로 rewrite. Spec E 후 `--reapply` 가 user-local override 도 rewrite 하는지 결정.

권고: `--reapply` 는 target 옵션 따라 (`--target=repo` 또는 `--target=user-local`) 동작.

---

## §8 다음 cycle 작업 (구현)

1. `src/task/discovery.ts` (omp upstream) inspection → user-local override path 후보 정확 확인 → AC#1 검증
2. omp 미지원 시 upstream PR or fallback 옵션 (옵션 A — extension dispatch hook)
3. `/pi-oven:setup --target=user-local` 구현
4. `/pi-oven:setup --status` 에 resolution chain 표시 추가
5. test: smoke ping 으로 user-local override 가 active model 결정하는지 검증
6. README + setup-wizard.md §4 정정 (user-local override 안내)
