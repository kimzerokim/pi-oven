## Goal

사용자가 승인한 방향대로 **agent namespace를 `pi-oven:<role>`에서 `pov:<role>`로 직접 cutover**하고, 이미 `pov:*`인 workflow-skill surface를 **한 군데에서만 보이는 단일 source-of-truth**로 재정렬하며, stale install / dual-surface / runtime drift를 **조용한 fallback 없이 명시적으로 드러내는** 실행 계획을 정의한다.

이 계획은 **코드 변경 전용 설계/실행 문서**다. 이번 작업의 비목표는 구현 자체가 아니라, 구현을 바로 분할/위임할 수 있는 dependency-safe 실행 순서를 고정하는 것이다.

## Evidence baseline

이 계획은 아래 세 근거를 출발점으로 삼는다.

- `docs/harness/surveys/2026-07-09-pov-install-and-namespace-survey.md`
- `agent://CompatTrace`
- `agent://AgentPrefixImpact`

핵심 사실:

- skill public surface는 이미 `pov:*`가 canonical이다.
- agent routing / registry / persisted override key / file naming은 아직 `pi-oven:*`에 하드 고정돼 있다.
- 현재 머신에서는 **npm-linked plugin surface**와 **marketplace cache surface**가 동시에 살아 있어 bare skill read가 stale cache를 타는 실제 drift가 관찰됐다.
- direct cutover는 alias-only patch가 아니라 **runtime + setup + persisted state + file registry + docs/tests**를 함께 건드리는 broad migration이다.

## Final-state contract

이번 cutover가 끝난 뒤의 목표 상태는 아래와 같다.

1. **Agent canonical namespace**
   - 모든 runtime dispatch, injected guidance, persisted model override key, agent frontmatter self-name이 `pov:<role>`만 사용한다.
   - bare role 입력은 필요 시 `pov:<role>`로만 canonicalize한다.
   - `pi-oven:<role>`는 더 이상 정상 canonical alias가 아니다. 남는다면 stale install / stale prompt / stale config 감지용 명시적 migration path로만 존재해야 한다.

2. **Workflow-skill public surface**
   - public skill namespace는 계속 `pov:<skill>`이다.
   - proof surface는 지금처럼 exact plugin-owned `.../SKILL.md` read target을 유지한다.
   - bare `skill://<name>`는 supported proof surface가 아니다.

3. **Single visible `pov` skill surface**
   - visible workflow-skill ownership은 계속 `skills.includeSkills = ["pov:*"]` 기준이다.
   - runtime / setup / doctor / standalone truth output이 **같은 active plugin root**를 기준으로 skill surface를 설명한다.
   - stale cache나 dual install이 있으면 묵살하지 않고 exact path와 remediation을 보여준다.

4. **Persisted routing state**
   - `task.agentModelOverrides`와 관련 read/write/reset/import/status path는 `pov:<role>`를 canonical persisted key로 사용한다.
   - 기존 `pi-oven:<role>` persisted key는 migration 대상이며, silent fallback이 아니라 **read-old / write-new / diagnose-conflict** 방식으로 정리한다.
   - global/project 두 layer는 effective merge 전에 **scope별 canonicalization**을 거치며, migration success는 해당 scope의 old key 제거까지 끝나야 한다. 최종 healthy end-state는 어느 live scope에도 `pi-oven:<role>` key가 남지 않은 상태다.

5. **Authoritative instruction + doctor surfaces**
   - `CLAUDE.md`, setup/doctor/help copy, standalone truth output이 `pov:<role>`와 `agents/pov-*.md` contract를 authoritative로 설명한다.
   - doctor implementation은 agent rename 이후에도 실제 shipped agent files와 persisted-state matrix를 기준으로 health를 판정하며, legacy filename assumption으로 거짓 FAIL을 내지 않는다.

6. **Intentional non-goals / namespace boundaries**
   - marketplace package id `pi-oven@kzk`, plugin id `pi-oven`, command namespace `/pi-oven:*`는 이번 작업의 rename 대상이 아니다.
   - 즉, **agent/skill runtime namespace는 `pov:*`**, **package/command identity는 `pi-oven`** 라는 경계를 문서와 runtime copy에서 명확히 고정한다.

## Delivery invariants

- 장기적인 dual writer 금지. migration 동안에도 새 write는 `pov:*`만 생성한다.
- 조용한 compatibility 금지. old namespace / stale install / duplicate surfaces는 모두 explicit diagnostic 또는 one-shot migration으로 처리한다.
- mixed global/project 상태에서 legacy residue가 남아 있으면 healthy로 승격하지 않는다. cleanup 완료는 모든 live scope에서 old key가 제거됐을 때만 인정한다.
- `pov` skill ownership truth는 계속 `skills.includeSkills = ["pov:*"]`다. disk deletion이나 sibling suppression은 canonical ownership이 아니다.
- repo 안에서 `pi-oven` 문자열이 남아도 되는 곳은 **package/command identity**, **historical docs**, **migration diagnostics/tests** 뿐이다. agent namespace로서의 `pi-oven:<role>`는 최종 상태에서 사라져야 한다.
- direct cutover이므로 마지막 파동에서는 runtime/documentation/help/example/lint/test가 모두 같은 surface를 가리켜야 한다.

---

# Wave 1 — Canonical namespace contract freeze

이 wave는 전체 migration의 선행 조건이다. 여기서 `pov:<role>`가 최종 canonical name이라는 계약을 runtime/gate/prompt/validator에 먼저 고정한다.

## Work item W1-A — Runtime dispatch / gate canonicalization을 `pov:<role>`로 뒤집기

**Depends on**
- none

**Parallelizable slices**
- 없음. gate-handler / rules-injector / runtime notice는 같은 contract를 공유하므로 한 lane에서 먼저 고정해야 한다.

**Files**
- Modify:
  - `.omp/extensions/pi-oven-runtime/gate-handler.ts`
  - `.omp/extensions/pi-oven-runtime/rules-injector.ts`
  - `.omp/extensions/pi-oven.ts`
  - 필요 시 same-contract helper가 이미 존재하는 범위 내의 관련 runtime 파일
- Test:
  - `tests/extensions/pi-oven-runtime/gate-handler.test.ts`
  - `tests/extensions/pi-oven-runtime/rules-injector.test.ts`
  - `tests/extensions/pi-oven.test.ts`
  - `tests/extensions/repro-parsing.test.ts`

**Steps**
- foreign namespace blocking / bare-role canonicalization / injected conduct 문구를 `pov:<role>` 기준으로 재작성한다.
- runtime이 old `pi-oven:<role>`를 마주치면 조용히 canonicalize하지 말고, stale prompt/install/config 가능성을 설명하는 진단 경로로 분기한다.
- parent-only orchestrator conduct와 skill-driven dispatch examples가 `pov:<role>`만 말하도록 바꾼다.
- runtime notice와 parsing tests가 새 canonical contract를 고정하도록 갱신한다.

**Acceptance**
- 정상 runtime path는 agent name으로 `pov:<role>`만 생성/주입/승인한다.
- bare role은 `pov:<role>`로만 귀결된다.
- old `pi-oven:<role>`는 silent success가 아니라 explicit migration/stale-state signal이 된다.

**Verification**
- `bun test tests/extensions/pi-oven-runtime/gate-handler.test.ts tests/extensions/pi-oven-runtime/rules-injector.test.ts tests/extensions/pi-oven.test.ts tests/extensions/repro-parsing.test.ts`

## Work item W1-B — Lint / validator / registry-facing namespace invariants를 새 canonical로 동결

**Depends on**
- W1-A complete

**Parallelizable slices**
- Wave 2 작업 준비를 위해 먼저 끝내야 한다. 병렬화하지 않는다.

**Files**
- Modify:
  - `scripts/lint-agents.ts`
  - `scripts/lint-skills.ts`
  - `.omp/extensions/pi-oven.ts`
- Test:
  - `tests/scripts/lint-agents.test.ts`
  - `tests/scripts/lint-skills.test.ts`
  - `tests/extensions/pi-oven.test.ts`

**Steps**
- agent-name invariant를 `pov:<role>`로 전환한다.
- skill body / command doc 안의 agent token validation도 `pov:<role>`를 canonical로 보도록 바꾼다.
- command namespace `/pi-oven:*`와 package id `pi-oven@kzk`는 rename 대상이 아니라는 예외를 lint/test에 명시한다.

**Acceptance**
- lint가 `pov:<role>` agent refs를 canonical로 잠그고, `pi-oven:<role>`는 migration/diagnostic 예외가 아닌 한 실패시킨다.
- `/pi-oven:*` command refs와 package identity는 오탐 없이 계속 허용된다.

**Verification**
- `bun test tests/scripts/lint-agents.test.ts tests/scripts/lint-skills.test.ts tests/extensions/pi-oven.test.ts`
- `bun run lint:agents`
- `bun run lint:skills`

---

# Wave 2 — Persisted config and migration semantics

Wave 1에서 canonical contract가 고정되면, global/project setup path를 `read-old / write-new / diagnose-conflict` 전략으로 전환한다.

## Work item W2-A — Global config writers/readers를 `pov:<role>` persisted key로 cutover

**Depends on**
- W1-B complete

**Parallelizable slices**
- W2-B와 병렬 가능. 단, mixed-state matrix / cleanup contract는 먼저 짧게 고정한다.

**Files**
- Modify:
  - `scripts/pi-oven-setup/config-yml.ts`
  - `scripts/pi-oven-setup/apply.ts`
  - `scripts/pi-oven-setup/override.ts`
  - `scripts/pi-oven-setup/import.ts`
  - `scripts/pi-oven-setup/reset.ts`
  - `scripts/pi-oven-setup/status.ts`
- Test:
  - `tests/scripts/pi-oven-setup/config-yml.test.ts`
  - `tests/scripts/pi-oven-setup/apply.test.ts`
  - `tests/scripts/pi-oven-setup/override.test.ts`
  - `tests/scripts/pi-oven-setup/import.test.ts`
  - `tests/scripts/pi-oven-setup/reset.test.ts`
  - `tests/scripts/pi-oven-setup/status.test.ts`
  - `tests/scripts/pi-oven-setup-cli.test.ts`

**Steps**
- global read path가 `pov:*`를 우선 읽고, legacy `pi-oven:*`만 있는 경우 migration candidate로 감지하되 현재 값은 보존한다.
- write / override / import / reset은 오직 `pov:*`만 내보내도록 바꾼다.
- 같은 global scope 안에 `pov:*`와 `pi-oven:*`가 둘 다 있고 값이 다를 때는 `pov:*`를 effective 값으로 삼되, 상태/doctor copy에서 conflict로 분류한다.
- status/setup test matrix에 최소 아래 조합을 고정한다.
  - global old only + no project override
  - global old + project new
  - global new + project old
  - same-scope dual-key conflict
- one-shot migration 또는 rewrite flow는 **해당 global scope를 원자적으로 rewrite**한다. 즉, effective legacy 값을 대응 `pov:*` key로 materialize한 뒤 같은 scope의 migrated `pi-oven:*` key를 삭제하고 나서만 success를 보고한다.

**Acceptance**
- global persisted routing의 canonical key는 `pov:<role>`다.
- old `pi-oven:<role>`만 있던 global state는 migration candidate로 진단된다.
- mixed-state matrix가 status/test surface에 명시적으로 반영된다.
- 성공한 global migration 이후에는 global scope에 live `pi-oven:<role>` key가 남지 않는다.
- 새 write path가 old key를 다시 생성하지 않는다.
- conflicting dual keys는 silent fallback 없이 드러난다.

**Verification**
- `bun test tests/scripts/pi-oven-setup/config-yml.test.ts tests/scripts/pi-oven-setup/apply.test.ts tests/scripts/pi-oven-setup/override.test.ts tests/scripts/pi-oven-setup/import.test.ts tests/scripts/pi-oven-setup/reset.test.ts tests/scripts/pi-oven-setup/status.test.ts tests/scripts/pi-oven-setup-cli.test.ts`

## Work item W2-B — Project settings / project status를 같은 migration contract로 맞추기

**Depends on**
- W1-B complete

**Parallelizable slices**
- W2-A와 병렬 가능. 동일한 mixed-state vocabulary를 공유해야 한다.

**Files**
- Modify:
  - `scripts/pi-oven-setup/project-settings.ts`
  - `scripts/pi-oven-setup/project-config.ts`
  - `scripts/pi-oven-setup/apply.ts`
  - `scripts/pi-oven-setup/status.ts`
- Test:
  - `tests/scripts/pi-oven-setup/project-settings.test.ts`
  - `tests/scripts/pi-oven-setup/project-config.test.ts`
  - `tests/scripts/pi-oven-setup/status.test.ts`
  - `tests/scripts/pi-oven-setup-cli.test.ts`

**Steps**
- project `.omp/settings.json` read/write가 global과 동일하게 `pov:*` canonical persisted key를 쓰도록 바꾼다.
- project-local override/import/reset/status path가 legacy `pi-oven:*` key를 migration 대상으로 진단하게 한다.
- merge/status path는 **scope별 canonicalization 후 기존 global < project precedence**를 유지하고, 아래 mixed-state를 별도 분류한다.
  - global old + project new
  - global new + project old
  - project old only
  - project same-scope dual-key conflict
- project migration/rewrite도 project scope를 원자적으로 정리한다. 즉, migrated `pov:*`를 쓴 뒤 같은 project scope의 old key를 제거한다.
- 최종 healthy 상태는 project/global 어느 live scope에도 `pi-oven:<role>` key가 남지 않았을 때만 성립하도록 status copy를 고정한다.

**Acceptance**
- project scope도 global scope와 동일한 `pov:*` migration semantics를 따른다.
- project status가 old-key-only / dual-key-conflict / mixed-state(`global old + project new`, `global new + project old`) / healthy-pov 상태를 구분한다.
- 성공한 project migration 이후에는 project scope에 live `pi-oven:<role>` key가 남지 않는다.
- 최종 cleanup/end-state 규칙이 global과 project 양쪽에 대해 명시적으로 닫힌다.

**Verification**
- `bun test tests/scripts/pi-oven-setup/project-settings.test.ts tests/scripts/pi-oven-setup/project-config.test.ts tests/scripts/pi-oven-setup/status.test.ts tests/scripts/pi-oven-setup-cli.test.ts`

# Wave 3 — Agent registry and file-system cutover

이 wave에서 agent frontmatter self-name, file naming, cache/validator discovery를 실제로 `pov` 기준으로 바꾼다. Wave 2 이전에 하면 persisted routing key와 registry key가 어긋날 수 있으므로 순서를 바꾸지 않는다.

## Work item W3-A — Agent file naming + frontmatter self-name을 `pov`로 rename

**Depends on**
- W2-A complete
- W2-B complete

**Parallelizable slices**
- 24개 agent file의 mechanical rename/body token rewrite는 병렬화 가능.
- 단, registry/discovery code를 건드리는 W3-B와 merge 순서는 맞춰야 하므로 한 번에 제출 가능한 작업 단위로 쪼갠다.

**Files**
- Modify / rename:
  - `agents/pi-oven-*.md` → `agents/pov-*.md`
  - 각 agent frontmatter `name: pov:<role>`
  - agent body 안의 peer/self dispatch refs
- Test:
  - `bun run lint:agents`
  - `tests/scripts/lint-agents.test.ts`

**Steps**
- 24개 agent file을 새 filename convention으로 rename한다.
- frontmatter self-name과 body 내 peer refs를 `pov:<role>`로 정렬한다.
- old filename convention을 기대하는 repo-local references를 식별해 W3-B/W4에서 정리한다.

**Acceptance**
- 모든 shipped agent file이 `pov-*.md` + `name: pov:<role>` invariant를 만족한다.
- agent prose 안에 old `pi-oven:<role>` self/peer refs가 남지 않는다. 단, migration diagnostic 예시는 명시적으로 예외 처리한다.

**Verification**
- `bun run lint:agents`
- `bun test tests/scripts/lint-agents.test.ts`

## Work item W3-B — Registry validation / rewriter / cache resolution이 새 file contract를 읽게 만들기

**Depends on**
- W3-A complete

**Parallelizable slices**
- 없음. file discovery, validation, cache resolution은 같은 invariant를 공유한다.

**Files**
- Modify:
  - `scripts/pi-oven-setup/agent-rewriter.ts`
  - `scripts/pi-oven-setup/cache-resolver.ts`
  - `.omp/extensions/pi-oven.ts`
  - `scripts/lint-agents.ts`
  - 필요 시 `scripts/pi-oven-setup/validate.ts`
- Test:
  - `tests/scripts/pi-oven-setup/agent-rewriter.test.ts`
  - `tests/scripts/pi-oven-setup/cache-resolver.test.ts`
  - `tests/scripts/pi-oven-setup/validate.test.ts`
  - `tests/extensions/pi-oven.test.ts`
  - `tests/extensions/repro-parsing.test.ts`

**Steps**
- file discovery 규칙을 `pov-*.md`로 바꾼다.
- rewriter / cache resolver / registry validation이 새 filename + frontmatter contract를 읽고 검증하게 만든다.
- runtime/plugin root detection이 agent registry scan에서 old filename assumption을 더 이상 갖지 않도록 정리한다.

**Acceptance**
- runtime/setup/validator가 모두 `pov-*.md` agent registry를 정상적으로 발견한다.
- old `pi-oven-*.md` filename assumption이 load-bearing contract로 남지 않는다.

**Verification**
- `bun test tests/scripts/pi-oven-setup/agent-rewriter.test.ts tests/scripts/pi-oven-setup/cache-resolver.test.ts tests/scripts/pi-oven-setup/validate.test.ts tests/extensions/pi-oven.test.ts tests/extensions/repro-parsing.test.ts`

---

# Wave 4 — Single-surface `pov` skills and stale-install hardening

Wave 4는 “`pov` skill이 한 군데에서만 보이는 것처럼 보이게” 만드는 실질 작업이다. 핵심은 docs cleanup이 아니라 **active plugin root를 하나로 설명하고 stale cache drift를 노출하는 것**이다.

## Work item W4-A — Skill index / owned-read-target / active plugin root를 하나의 truth로 맞추기

**Depends on**
- W3-B complete

**Parallelizable slices**
- W4-B와 일부 병렬 가능하지만, active-root diagnostic wording은 먼저 고정하는 편이 안전하다.

**Files**
- Modify:
  - `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts`
  - `.omp/extensions/pi-oven-runtime/gate-handler.ts`
  - `.omp/extensions/pi-oven.ts`
  - `scripts/pi-oven-setup/shipped-skill-registry.ts`
  - `scripts/pi-oven-setup/cache-resolver.ts`
  - `scripts/pi-oven-setup/standalone-truth-surface.ts`
  - `scripts/pi-oven-setup/status.ts`
- Test:
  - `tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts`
  - `tests/extensions/pi-oven-runtime/gate-handler.test.ts`
  - `tests/extensions/pi-oven.test.ts`
  - `tests/scripts/pi-oven-setup/cache-resolver.test.ts`
  - `tests/scripts/pi-oven-setup/status.test.ts`
  - `tests/plugin/skill-discoverability.test.ts`

**Steps**
- public skill name generation은 계속 `pov:*`를 쓰되, source-of-truth를 active plugin root + shipped-skill registry 기준으로 고정한다.
- old marketplace cache / npm-linked surface drift가 있으면 어느 path가 active이고 어느 path가 stale인지 exact path로 보여준다.
- exact plugin-owned `SKILL.md` proof target contract는 유지하되, legacy bookkeeping alias가 남아 있다면 필요 최소한의 migration scope로 축소한다.
- bare skill surface가 stale cache를 타는 현상을 doctor/status/runtime에서 명시적으로 드러낸다.

**Acceptance**
- visible `pov` workflow-skill surface와 proof target 설명이 모두 같은 active plugin root를 기준으로 나온다.
- stale marketplace cache / duplicate plugin surface는 “조용한 성공”이 아니라 explicit drift diagnosis가 된다.
- skill discoverability tests가 새 single-surface story를 고정한다.

**Verification**
- `bun test tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts tests/extensions/pi-oven-runtime/gate-handler.test.ts tests/extensions/pi-oven.test.ts tests/scripts/pi-oven-setup/cache-resolver.test.ts tests/scripts/pi-oven-setup/status.test.ts tests/plugin/skill-discoverability.test.ts`

## Work item W4-B — Skill bodies / commands / help/docs를 새 namespace split에 맞춰 정리

**Depends on**
- W3-A complete
- W4-A diagnostic terminology freeze

**Parallelizable slices**
- skill body mechanical rewrite와 help/docs rewrite는 병렬 가능.
- 단, lint-skills와 final copy review는 한 번에 합친다.

**Files**
- Modify:
  - `skills/**/*.md`
  - `CLAUDE.md`
  - `commands/setup.md`
  - `commands/doctor.md`
  - `scripts/pi-oven-setup.ts`
  - `scripts/pi-oven-setup/suppress-sibling.ts`
  - `README.md`
  - 필요 시 repo-local docs/tests 중 user-facing namespace 설명이 있는 파일
  - `scripts/lint-skills.ts`
- Test:
  - `tests/scripts/lint-skills.test.ts`
  - `tests/plugin/skill-discoverability.test.ts`
  - `tests/plugin/pi-oven-doctor.test.ts`
  - `tests/plugin/command-namespacing.test.ts`

**Steps**
- skill bodies 안의 agent dispatch examples를 `pov:<role>`로 바꾼다.
- `CLAUDE.md`의 authoritative repo instructions를 직접 갱신해 `task.agentModelOverrides["pov:<role>"]`, `agents/pov-*.md`, 그리고 “runtime agent/skill namespace는 `pov:*`, command namespace는 `/pi-oven:*`, package install id는 `pi-oven@kzk`” 경계를 canonical contract로 적게 한다.
- `commands/*.md`, `scripts/pi-oven-setup.ts`, `scripts/pi-oven-setup/suppress-sibling.ts` 등 setup/help/dispatch surface가 같은 namespace story를 말하게 맞춘다.
- stale install remediation과 reinstall guidance가 새 namespace contract를 깨지 않도록 wording을 다듬는다.
- legacy `pi-oven:<role>` 예시는 migration troubleshooting 섹션으로만 밀어 넣는다.

**Acceptance**
- `CLAUDE.md`가 더 이상 `pi-oven:<role>` / `agents/pi-oven-*.md`를 authoritative contract로 재주입하지 않는다.
- user-facing docs/help/examples가 `pov` agent+skill surface를 일관되게 사용한다.
- `/pi-oven:*` command namespace와 `pi-oven@kzk` package identity는 유지되지만, agent namespace와 혼동되지 않는다.
- skill lint가 새 example surface를 고정한다.

**Verification**
- `bun run lint:skills`
- `bun test tests/scripts/lint-skills.test.ts tests/plugin/skill-discoverability.test.ts tests/plugin/pi-oven-doctor.test.ts tests/plugin/command-namespacing.test.ts`

## Work item W4-C — Setup / doctor / runtime notices에 stale-install 및 migration 상태를 노출

**Depends on**
- W4-A complete
- W4-B complete

**Parallelizable slices**
- 없음. 같은 copy/diagnostic vocabulary를 공유한다.

**Files**
- Modify:
  - `.omp/extensions/pi-oven.ts`
  - `scripts/pi-oven-doctor.ts`
  - `scripts/pi-oven-setup/status.ts`
  - `scripts/pi-oven-setup/standalone-truth-surface.ts`
  - `commands/setup.md`
  - `commands/doctor.md`
  - `README.md`
- Test:
  - `tests/extensions/pi-oven.test.ts`
  - `tests/plugin/pi-oven-doctor.test.ts`
  - `tests/scripts/pi-oven-setup/status.test.ts`
  - `tests/scripts/pi-oven-setup-cli.test.ts`

**Steps**
- runtime session-start notice, doctor implementation/output, standalone truth output, setup status가 아래 상태를 같은 언어로 분류하게 만든다.
  - healthy single active `pov` surface
  - old `pi-oven:*` config keys detected
  - dual plugin surface / stale cache detected
  - mixed global/project migration state detected
  - agent namespace prompt/install drift detected
- `scripts/pi-oven-doctor.ts`의 agent inventory/health check가 renamed `agents/pov-*.md` / `name: pov:<role>` contract를 읽도록 바꿔, W3 rename 이후 legacy filename assumption 때문에 거짓 FAIL을 내지 않게 한다.
- remediation copy는 install-aware path resolution을 유지하고, user action을 한 단계씩 제시한다.

**Acceptance**
- doctor implementation과 command surface가 W3 rename 뒤에도 `agents/pi-oven-*.md` 가정 때문에 false FAIL을 내지 않는다.
- runtime/setup/doctor/truth surfaces가 namespace migration 상태를 같은 분류 체계로 보여준다.
- stale install / dual surface / old config가 모두 actionable diagnostic으로 노출된다.

**Verification**
- `bun test tests/extensions/pi-oven.test.ts tests/plugin/pi-oven-doctor.test.ts tests/scripts/pi-oven-setup/status.test.ts tests/scripts/pi-oven-setup-cli.test.ts`

# Wave 5 — Repo-wide cleanup and proof

마지막 wave는 “코드가 바뀌었다”가 아니라 “surface contract가 끝까지 닫혔다”를 증명하는 단계다.

## Work item W5-A — Remaining old agent namespace and file-name expectations 제거

**Depends on**
- W4-C complete

**Parallelizable slices**
- mechanical leftover cleanup는 병렬 가능.
- 최종 search audit과 allowlist 판정은 한 lane에서 수행한다.

**Files**
- Modify as needed across touched runtime/setup/skills/tests/docs surfaces, including `CLAUDE.md`, `scripts/pi-oven-doctor.ts`, `scripts/pi-oven-setup.ts`, `scripts/pi-oven-setup/suppress-sibling.ts`
- Test / audit:
  - `bun run lint:agents`
  - `bun run lint:skills`
  - targeted namespace scans during implementation

**Steps**
- repo-wide `pi-oven:<role>` / `pi-oven-*.md` 잔존치를 제거한다.
- 단, 아래 allowlist는 유지 가능하다.
  - package name `pi-oven`
  - marketplace id `pi-oven@kzk`
  - command namespace `/pi-oven:*`
  - migration diagnostics / historical docs / explicit compatibility tests
- final review에서 load-bearing surface(`CLAUDE.md`, doctor implementation, setup/help dispatcher`)에 old namespace/file-name assumption이 남지 않았는지 다시 확인한다.

**Acceptance**
- old agent namespace/file-name assumption이 allowlist 밖에서는 사라진다. 여기에는 `CLAUDE.md`, `scripts/pi-oven-doctor.ts`, setup/help entrypoint도 포함된다.
- 남아 있는 `pi-oven` 토큰은 package/command identity 또는 intentional migration context로만 설명 가능하다.

**Verification**
- `bun run lint:agents`
- `bun run lint:skills`
- implementation-time targeted scans over `CLAUDE.md`, `agents/`, `skills/`, `.omp/extensions/`, `scripts/pi-oven-doctor.ts`, `scripts/pi-oven-setup/`, `tests/`, `README.md`, `commands/`

## Work item W5-B — End-to-end verification gate

**Depends on**
- W5-A complete

**Parallelizable slices**
- 없음. 최종 gate다.

**Verification bundle**
- `bun run check`
- `bun run lint:agents`
- `bun run lint:skills`
- `bun test tests/extensions/pi-oven.test.ts tests/extensions/repro-parsing.test.ts tests/extensions/pi-oven-runtime/gate-handler.test.ts tests/extensions/pi-oven-runtime/rules-injector.test.ts tests/extensions/pi-oven-runtime/skill-keyword-loader.test.ts tests/scripts/pi-oven-setup/config-yml.test.ts tests/scripts/pi-oven-setup/apply.test.ts tests/scripts/pi-oven-setup/override.test.ts tests/scripts/pi-oven-setup/import.test.ts tests/scripts/pi-oven-setup/reset.test.ts tests/scripts/pi-oven-setup/status.test.ts tests/scripts/pi-oven-setup/project-settings.test.ts tests/scripts/pi-oven-setup/project-config.test.ts tests/scripts/pi-oven-setup/agent-rewriter.test.ts tests/scripts/pi-oven-setup/cache-resolver.test.ts tests/scripts/pi-oven-setup/validate.test.ts tests/scripts/pi-oven-setup-cli.test.ts tests/plugin/skill-discoverability.test.ts tests/plugin/pi-oven-doctor.test.ts tests/plugin/command-namespacing.test.ts`
- `bun test` (broad regression pass because this migration crosses runtime + setup + docs/lints + generated surfaces)

**Acceptance**
- typecheck, lints, targeted suites, full suite가 모두 green이다.
- runtime/gate/setup/status/doctor/`CLAUDE.md`/docs가 같은 namespace story를 말한다.
- fresh install, stale cache, old config, mixed namespace matrix, post-rename doctor regression 각각에 대한 verification evidence가 존재한다.

---

## Dependency-safe execution summary

### 반드시 순차인 구간

- **Wave 1 전체**: canonical contract를 먼저 고정해야 이후 migration semantics와 file rename이 흔들리지 않는다.
- **Wave 3 전체**: persisted key migration 없이 agent registry를 먼저 rename하면 config key / registry key mismatch가 생길 수 있다.
- **W4-C → Wave 5**: hardening copy와 truth surfaces가 정리된 뒤에야 최종 cleanup/proof가 의미 있다.

### 병렬 가능한 구간

- **W2-A global config lane** ↔ **W2-B project settings lane**
- **W3-A 24개 agent file mechanical rename slices** (단, W3-B merge order 주의)
- **W4-B skill body rewrite lane** ↔ **W4-B docs/help rewrite lane**
- **W5-A leftover cleanup slices** (최종 allowlist 판정은 단일 lane)

### 권장 wave dispatch 방식

1. `W1-A + W1-B`를 한 implementation lead lane에서 먼저 고정
2. `W2-A` / `W2-B`를 병렬 subagent 두 개로 분리
3. `W3-A` mechanical agent rename과 `W3-B` registry/validator lane을 연동 실행
4. `W4-A`를 먼저 안정화한 뒤 `W4-B` / `W4-C`를 순차 마무리
5. `W5-A` cleanup 후 `W5-B` 단일 verification gate

## Main risks

1. **Persisted override silent fallback**
   - old `pi-oven:*` key를 제대로 migration하지 못하면 OMP가 unmapped role을 session default로 떨어뜨릴 위험이 있다.

2. **Dual plugin surface drift**
   - npm-linked repo와 marketplace cache가 동시에 살아 있는 환경에서, runtime/setup/doctor가 서로 다른 root를 바라보면 single-surface story가 무너진다.

3. **Namespace boundary confusion**
   - agent/skill runtime namespace는 `pov:*`로 가되 command/package identity는 계속 `pi-oven`이라, docs/lint/tests가 이 경계를 명확히 못 박지 않으면 회귀가 빠르게 생긴다.

4. **Blast radius across repo-local prose and tests**
   - 조사 결과 `pi-oven:`/`pi-oven-*` 토큰이 광범위하게 퍼져 있어, runtime만 바꾸고 prose/tests를 늦게 정리하면 stale examples가 다시 old namespace를 재생산한다.

5. **[INFERENCE] Installed-user external state**
   - repo 밖 실제 사용자 머신에는 다양한 `~/.omp/agent/config.yml` / project `.omp/settings.json` 조합이 이미 존재할 수 있다. 따라서 migration conflict path와 stale-state diagnostics를 테스트 fixture 수준 이상으로 신중히 다뤄야 한다.

## Overall acceptance

이 계획의 구현이 완료되면 아래가 동시에 성립해야 한다.

- runtime agent namespace는 `pov:<role>`로 완전히 cutover된다.
- workflow-skill public surface는 계속 `pov:<skill>`이고, visible ownership / proof target / diagnostics가 하나의 active plugin root story로 정렬된다.
- global/project persisted routing state는 `pov:<role>` key를 canonical로 쓰고 old `pi-oven:<role>` state를 migration 또는 explicit diagnostics로 처리하며, mixed-state matrix와 cleanup 종료 조건이 명시된다.
- agent file registry는 `pov-*.md` + `name: pov:<role>` contract로 동작한다.
- `CLAUDE.md`, doctor, setup/help/docs는 `pov` agent+skill surface와 `/pi-oven:*` command surface의 경계를 같은 언어로 설명한다.
- stale install / dual cache / old namespace usage가 묵살되지 않고 actionable하게 노출되며, doctor는 post-rename 상태를 거짓 FAIL 없이 판정한다.
