# 2026-07-07 pi-oven integrated control-plane redesign

## Document status
- Status: Approved design, ready for implementation planning
- Scope: workflow-skill ownership cutover, setup truth, autonomy resume parity, duplicate setup warning hardening, `pi-oven_ask` option spacing polish
- Primary evidence:
  - `docs/harness/surveys/2026-07-07-skill-ownership-survey.md`
  - `local://gajae-style-feasibility.md`
  - `local://gajae-style-replan.md`
  - `local://setup-warning-diagnosis.md`
  - `local://ultragoal-autonomy-survey.md`

## Goals
1. OMP-native `skills.includeSkills = ["pi-oven:*"]`를 default-on ownership mainline으로 승격해, **loaded workflow skill surface 자체**를 즉시 pi-oven-only surface로 cutover한다.
2. `--isolate`, `--suppress-sibling-skills`, empty `~/.claude/skills` 같은 legacy visibility controls를 ownership mainline과 분리하고, truthfully-classified compatibility aids로 재정의한다.
3. setup truth를 routing state 단일 진실원으로 재정의해, 실제 routing/prereq가 살아 있을 때 보이던 false `✗`를 제거한다.
4. setup warning hardening을 같은 control-plane 설계에 포함해, 동일 repo/session start 기준으로 ownership/setup notice가 한 번만 보이게 한다.
5. autonomy를 gajae 방향으로 끌어오되 branch/approval/skill-proof gate는 유지하고, blocked reason + next action + same-repo/branch restart target을 durable state로 남긴다.
6. `pi-oven_ask`는 현재 question/context body spacing은 유지하면서, **선택지 사이의 extra blank line만 제거**해 각 option이 다음 줄에 바로 이어지게 만든다.

## Non-goals
1. agents, commands, hooks, MCP servers까지 포함한 전면적 plugin exclusivity는 이번 범위가 아니다. 이번 설계의 exclusivity 범위는 **workflow skills only**다.
2. bootstrap-level gajae parity를 OMP/provider architecture 전반에 그대로 복제하는 작업은 이번 delivery의 blocking scope가 아니다. 그 축은 secondary OMP/architecture track으로 관리한다.
3. branch contract, approval handoff, skill ownership proof 같은 기존 write gate를 완화하지 않는다.
4. `pi-oven_ask`를 multi-select/general form engine으로 확장하지 않는다.
5. 다른 repo나 다른 branch로 autonomy를 이어붙이는 cross-repo resume는 지원하지 않는다. resume target은 **same repo / same branch**만 다룬다.
6. legacy visibility aids를 strict ownership과 동급으로 포장하는 우회 설계는 허용하지 않는다.

## Constraints
- Phase ordering은 고정이다: **owned skill-surface cutover -> ownership truth & compatibility rewrite -> setup truth -> autonomy -> hardening/UI**.
- rollout은 `/pi-oven:setup` 경로에서 **default-on**이다. opt-in compatibility mode를 새로운 정상 경로로 만들지 않는다.
- strict ownership의 canonical control은 effective `skills.includeSkills = ["pi-oven:*"]`다. 성공 기준도 “설정이 써졌다”가 아니라 **보이는 workflow skill surface가 pi-oven-only인지**다.
- empty `~/.claude/skills` directory 또는 `claude` provider만 비활성화한 상태는 workflow-skill ownership proof가 아니다. 실제 요구사항은 `~/.claude/skills`가 채워져 있어도 ownership mainline이 그 populated Claude workflow-skill source를 non-owning input으로 무시/필터링하는 것이다.
- `--isolate`와 `--suppress-sibling-skills`는 남을 수 있지만 secondary compatibility aids일 뿐 canonical ownership enforcement가 아니다.
- bootstrap-level gajae parity는 분명한 secondary track이지만, immediate owned-skill surface cutover의 blocker가 되어서는 안 된다.
- setup truth는 routing state가 소유한다. `setupCompletedAt` 같은 receipt/metadata는 보조 증거일 수는 있어도 단독 authority가 되면 안 된다.
- autonomy parity는 stop을 덜 하게 만드는 것만이 목표가 아니다. **왜 멈췄는지**, **다음에 무엇을 해야 하는지**, **어느 repo/branch에서 재개해야 하는지**가 restart 후에도 남아야 한다.
- `pi-oven_ask` spacing tweak는 body spacing을 바꾸지 않는다. question/context/detail block의 간격은 유지하고, option-to-option gap만 줄인다.

## Grounded evidence

### 1. OMP는 이미 immediate owned skill-surface cutover에 필요한 stronger mainline을 제공한다
- replan memo는 current OMP skill loader가 `skills.includeSkills` name filtering을 지원하고, `claude-plugins` skill names가 `<plugin>:<skill>` 형태로 namespaced 된다고 정리한다 (`local://gajae-style-replan.md:19-22`).
- 같은 memo의 local runtime probe는 `includeSkills: ["pi-oven:*"]` 적용 시 visible skill set이 47개에서 23개로 줄고, 남은 모든 skill이 `pi-oven:*`였다고 확인한다. 또한 `claude`를 꺼도 surface가 바뀌지 않아 ownership win이 `~/.claude` hiding이 아니라 skill filter 자체에서 왔다고 밝힌다 (`local://gajae-style-replan.md:20-22`).
- replan 결론은 “현재 OMP skill-surface controls로 **loaded skill surface를 pi-oven-only로 만들 수 있으므로**, mainline은 그것을 먼저 ship해야 한다”고 재정의한다 (`local://gajae-style-replan.md:39-44`, `:58-72`, `:100-107`).

### 2. empty `~/.claude/skills` 는 충분하지 않다
- ownership survey는 current `--isolate`가 `claude` provider만 끄고 `claude-plugins`는 의도적으로 남긴다고 확인한다. 즉 Claude home layer를 비워도 marketplace-plugin lane은 그대로 남는다 (`docs/harness/surveys/2026-07-07-skill-ownership-survey.md:131-136`).
- feasibility memo는 OMP가 discovery bootstrap에서 `claude`와 `claude-plugins`를 모두 import하고, skill loading에는 dedicated `claude-plugins` allowlist toggle이 없다고 정리한다 (`local://gajae-style-feasibility.md:19-27`).
- 따라서 empty `~/.claude/skills` 또는 `claude`-only isolation은 ownership mainline이 아니다. 실제 요구사항은 **Claude user workflow skills가 채워져 있어도** 그것이 `claude-plugins`나 namespaced marketplace workflow skills와 함께 pi-oven ownership truth를 오염시키지 않도록 무시/필터링하는 것이다. 이 finding은 문서/상태표시/테스트에 명시되어야 한다.

### 3. legacy helpers는 ownership mainline이 아니라 compatibility aids다
- sibling suppression은 두 namespace glob만 다루는 optional/global-only filter이고 (`docs/harness/surveys/2026-07-07-skill-ownership-survey.md:121-129`), `--isolate`도 pi-oven이 여전히 `claude-plugins`를 통해 로드되는 현재 구조 때문에 intentionally incomplete 하다 (`docs/harness/surveys/2026-07-07-skill-ownership-survey.md:131-136`).
- feasibility memo도 local tightening만으로는 true gajae-style이 되지 않으며, current plugin shape에서는 `~/.claude` ignore semantics 강화만으로 충분하지 않다고 정리한다 (`local://gajae-style-feasibility.md:15-30`).

### 4. bootstrap-level gajae parity는 여전히 OMP / architecture boundary를 건넌다
- replan memo는 true bootstrap parity가 여전히 OMP discovery bootstrap과 skill loader defaults를 건드리는 secondary track이라고 정리한다 (`local://gajae-style-replan.md:21-23`, `:73-78`, `:94-99`).
- feasibility memo는 clean gajae-style outcome이 provider bootstrap allowlist, plugin-skill gating, bundled/native skill registration 같은 OMP-side control points를 요구한다고 설명한다 (`local://gajae-style-feasibility.md:68-89`).
- 즉 immediate owned-skill surface cutover와 literal bootstrap parity는 **같은 문제가 아니며**, 후자는 명시적 secondary track으로 분리해야 한다.

### 5. setup warning의 false `✗`와 duplicate emission은 ownership mainline 수정 후에도 남는 별도 truth problem이다
- 현재 checklist는 `.omp/extensions/pi-oven.ts`의 `buildSetupChecklistNotice()` 하나에서 만들어지고, `readSetupComplete()`는 `setupCompletedAt` string만으로 completion을 판정한다 (`.omp/extensions/pi-oven.ts:192-234`).
- diagnosis는 실제 routing/prereq truth와 marker truth가 분리돼 있어 false-looking global `✗`가 생긴다고 확인했다 (`local://setup-warning-diagnosis.md:40-65`).
- 같은 diagnosis는 duplicate identical warning block은 별개의 emission problem일 가능성이 높고, repo code 안에서는 builder/call site가 하나만 확인됐다고 구분한다 (`local://setup-warning-diagnosis.md:78-134`).

### 6. autonomy는 durable control-plane state는 있지만, restart-safe next-action contract는 아직 얇다
- 현재 FSM store는 `active`, `requiredSkills`, `skillReads`, `ownedSkillReadTargets`, `continuationMarker`, `deepInterview`, `approvalFlow`를 보존한다 (`.omp/extensions/pi-oven-runtime/gate-state.ts:70-88`).
- project-state inventory도 runtime-owned state file을 `autonomous`, `push-consent`, `branch-contract` 세 개로만 정의한다 (`.omp/extensions/pi-oven-runtime/project-state.ts:7-77`).
- autonomy survey는 gajae가 ledger/next-action/goal-request 같은 durable resume contract를 가지는 반면, pi-oven은 아직 stop-text + stop-reason 중심 continuation이라는 점을 확인한다 (`local://ultragoal-autonomy-survey.md:32-40`, `:48-61`, `:103-125`).
- 같은 survey는 branch contract와 approval gate 자체는 이미 strict하게 유지되고 있으므로, parity 방향은 “gate 완화”가 아니라 “blocked reason과 restart resume의 내구성 강화”여야 한다고 읽힌다 (`local://ultragoal-autonomy-survey.md:76-106`).

### 7. `pi-oven_ask` spacing change는 isolated UI hardening으로 처리할 수 있다
- current ask renderer는 `QUESTION_PADDING_Y = 1`, `QUESTION_LINE_GAP = 1`, `OPTION_BLOCK_SPACER_LINES = 2`, `DETAIL_BLOCK_SPACER_LINES = 2`를 사용한다 (`.omp/extensions/pi-oven-runtime/pi-oven-ask.ts:174-177`).
- 따라서 approved tweak는 전체 body rhythm을 흔들지 않고 `OPTION_BLOCK_SPACER_LINES` contract만 조정하는 국소 변경으로 설계할 수 있다.

## Approved topology
- 이번 작업은 분리된 mini-fix 여러 개가 아니라 **integrated control-plane redesign 하나**로 다룬다.
- primary track의 첫 질문은 “current OMP surface에서 **loaded workflow skill surface**를 pi-oven-only로 만들 수 있는가?”다. 현재 evidence의 답은 **yes, via `skills.includeSkills = ["pi-oven:*"]`**다.
- ownership exclusivity의 mainline은 provider-hook-first speculation이 아니라 **owned skill-surface cutover now**다. `--isolate`, `--suppress-sibling-skills`, empty `~/.claude/skills`는 그 mainline을 보조하는 compatibility aids일 뿐이다.
- ownership truth rewrite는 반드시 empty `~/.claude/skills` insufficiency와 `claude-plugins` / namespaced marketplace skill caveat를 노출해야 한다.
- setup UX의 첫 acceptance는 “실제 routing이 살아 있는데 false `✗`가 보이지 않는다”이다.
- duplicate setup warning hardening은 별도 bug ticket으로 분리하지 않고 이 spec 안에서 setup truth와 함께 마무리한다.
- autonomy는 gajae-parity 방향을 따르지만, branch/approval/skill-proof gate는 그대로 엄격하게 유지한다.
- bootstrap-level gajae parity는 이 spec의 primary blocking track이 아니다. ownership bootstrap을 더 깊게 끌어올리는 OMP/architecture parity는 secondary track으로 분리한다.
- resume target은 same repo / same branch restart다. 다른 repo나 branch로 resume state를 재사용하지 않는다.
- `pi-oven_ask` option-spacing tweak는 hardening/UI tranche에 포함한다.

## Data model / state surfaces

| Surface | Cutover 후 authority | 역할 |
| --- | --- | --- |
| `.claude-plugin/plugin.json` | shipped workflow skill set | plugin이 소유한 workflow skill 목록의 canonical manifest |
| `scripts/pi-oven-setup/shipped-skill-registry.ts` | owned-skill mirror | setup/doctor/runtime이 같은 shipped skill allowlist를 재사용하는 registry mirror |
| effective OMP skill settings (`skills.includeSkills`) | immediate ownership truth | loaded workflow skill surface를 pi-oven-only로 자르는 canonical mainline control |
| `skills.ignoredSkills` / legacy provider disablement | compatibility aids only | 노이즈 감소 및 일부 legacy visibility 차단. ownership proof가 아니다 |
| `.omp/extensions/pi-oven-runtime/skill-keyword-loader.ts` | exact owned read-target proof | manifest -> owned read target -> matched skill contract를 runtime proof surface로 변환 |
| global omp routing config | global setup truth | machine-global routing/prereq readiness를 표현하는 단일 진실원 |
| `.omp/settings.json` | project setup truth | project-local routing layer의 단일 진실원 |
| `.pi-oven/config.json` | metadata / receipt only | language, setup receipt, human-facing metadata. readiness의 단독 authority가 아니다 |
| `.pi-oven/state/autonomous.json` | autonomy + approval control-plane state | ownership status, blocked reason, next action, resume target, continuation marker, deep-interview/approval state를 durable하게 보관 |
| `.pi-oven/state/branch-contract.json` | write gate prerequisite | branch/PR contract enforcement를 계속 소유 |

### Required additions inside `.pi-oven/state/autonomous.json`
`autonomous.json`은 새 파일을 더 만들기보다 현재 control-plane state를 확장하는 방향을 기본으로 한다. 최소한 아래 사실은 durable해야 한다.
- ownership status: `owned-surface-active` vs `compatibility-only` vs `ownership-not-established`
- blocked reason: branch contract missing, approval pending, skill proof incomplete, verifier pending, policy halt 등
- next action: operator/runtime이 다음 turn 또는 restart 시 무엇을 해야 하는지 설명하는 structured action
- resume target: repo root + branch + captured-at metadata

이 네 가지는 prompt-only lore가 아니라 state surface여야 하며, restart 후 동일 repo/branch에서 다시 읽혀야 한다.

## Control-plane architecture

### 1. Owned skill-surface layer
1. shipped workflow skill allowlist는 기존 manifest + shipped registry + exact owned read target proof를 계속 canonical source로 사용한다.
2. immediate canonical control은 effective `skills.includeSkills = ["pi-oven:*"]`다. runtime, setup status, doctor는 이 policy가 실제 workflow skill surface를 pi-oven-only로 만드는지를 ownership truth의 1순위로 사용한다.
3. 성공 기준은 “Claude home tree가 조용하다”가 아니라 **보이는 workflow skill surface가 `pi-oven:*`만 남는가**다.
4. filter가 unavailable 하거나 foreign workflow skills가 여전히 보이면 runtime은 strict ownership claim을 하지 않고 fail-close / degraded ownership-not-established path를 택한다.
5. `--isolate`, `--suppress-sibling-skills`, empty `~/.claude/skills`는 compatibility aids로 남을 수는 있지만 canonical enforcement path가 되어서는 안 된다.

### 2. Ownership truth / compatibility layer
1. runtime notice, `/pi-oven:setup --status`, doctor-like diagnostics는 적어도 `owned-surface active`, `compatibility aids only`, `ownership not established`를 구분해야 한다.
2. 모든 ownership truth surface는 empty `~/.claude/skills` insufficiency와 `claude-plugins` / namespaced marketplace skill caveat를 명시한다.
3. legacy aids가 켜져 있어도 mainline filter가 없으면 ownership active로 보고하면 안 된다.
4. bootstrap-level parity는 여기서 “future architectural track”으로만 노출하고, Task 1의 성공 조건에 숨겨 넣지 않는다.

### 3. Setup truth layer
1. global/project setup readiness는 routing state와 runtime prerequisites에서 직접 도출한다.
2. `setupCompletedAt`는 receipt일 수는 있지만 readiness authority가 아니다.
3. runtime notice, `/pi-oven:setup --status`, doctor-like diagnostics는 모두 같은 readiness classification을 공유한다.
4. classification의 첫 UX 목표는 false global `✗` 제거다. project routing이 실제로 absent한 경우의 `✗`는 계속 보여야 한다.

### 4. Autonomy continuation layer
1. branch contract, approval, exact skill read proof, verifier gate는 모두 유지한다. parity 목표는 write barrier를 낮추는 것이 아니다.
2. autonomy가 멈추면 그 이유와 다음 action을 durable하게 남긴다.
3. session restart가 같은 repo/branch에서 일어나면 runtime은 persisted resume target을 읽고:
   - 자동 재개 가능한 경우는 continuation path를 재무장하고,
   - 사용자 개입이 필요한 경우는 blocked reason + next action을 재표시한다.
4. 다른 repo/branch에서는 resume state를 재사용하지 않고, mismatch를 명시적으로 버린다.

### 5. Notice and ask UI layer
1. setup checklist notice는 repo/session 기준 dedupe되어야 한다. host가 `session_start`를 두 번 쏘거나 extension instance가 중복돼도 동일 notice block이 반복되지 않아야 한다.
2. 같은 notice surface가 owned-surface active, compatibility-only ownership, missing project routing, healthy setup를 구분해서 보여야 한다.
3. `pi-oven_ask`는 question/context block spacing과 detail block spacing을 유지하고, option-to-option gap만 줄인다.
4. `Other` / `Ask about these choices` affordance와 current body copy rhythm은 그대로 유지한다.

## Phase ordering

### Phase 1 — Owned skill-surface cutover
- `skills.includeSkills = ["pi-oven:*"]`를 canonical ownership control로 승격한다.
- workflow skills only 범위에서 visible skill surface가 pi-oven-only인지 검증한다.
- immediate mainline이 skill filter라는 사실을 setup/runtime/docs에 맞춘다.

### Phase 2 — Ownership truth and compatibility rewrite
- `--isolate`, `--suppress-sibling-skills`, empty `~/.claude/skills`를 compatibility aids로 강등한다.
- empty `~/.claude/skills` insufficiency와 `claude-plugins` / namespaced marketplace skill caveat를 상태표시/문서/테스트에 명시한다.
- owned-surface active vs compatibility-only vs ownership-not-established classification을 통일한다.

### Phase 3 — Setup truth cleanup
- runtime notice와 CLI status의 readiness truth를 routing state로 통일한다.
- false global `✗`를 제거한다.
- marker/receipt는 보조 surface로만 남긴다.

### Phase 4 — Autonomy parity
- blocked reason, next action, resume target을 durable state로 확장한다.
- same repo / same branch restart에서 continuation 또는 blocked-state replay를 복구한다.
- branch/approval/skill-proof gate는 그대로 유지한다.

### Phase 5 — Hardening / UI
- duplicate setup warning emission을 dedupe guard로 막는다.
- ownership/setup truth notice copy를 final contract로 잠근다.
- `pi-oven_ask` option spacing tweak를 적용하고 snapshot/behavior tests를 잠근다.

## Secondary track — Bootstrap-level gajae parity
- 이 트랙의 질문은 “OMP bootstrap이 `claude` / `claude-plugins`를 애초에 어떻게 불러오고, 그보다 앞에서 ownership boundary를 만들 수 있는가?”다.
- feasible shapes는 provider bootstrap allowlist, plugin-skill gating, bundled/native skill registration, 또는 native-mirror architecture다 (`local://gajae-style-feasibility.md:31-47`, `:71-89`).
- secondary repo-local practical-equivalence 후보는 native `.omp` surfaces로 skills/agents/commands를 mirror한 뒤 `disabledProviders`를 결합하는 경로다. 다만 이것은 current mainline을 다시 바꿀 이유가 아니라, ownership secondary track 아래의 architecture candidate로만 관리한다.
- 이 트랙은 중요하지만, immediate owned skill-surface cutover의 blocking acceptance가 아니다.

## External OMP / architecture dependency
이 spec의 mainline은 더 이상 “provider hook first, 없으면 degraded fallback”이 아니다. evidence가 보여준 stronger truth는 다음과 같다.
- current OMP surface만으로도 `skills.includeSkills = ["pi-oven:*"]`를 통해 **owned workflow skill surface cutover now**가 가능하다 (`local://gajae-style-replan.md:39-44`, `:60-72`).
- literal bootstrap parity는 여전히 OMP/provider architecture dependency다 (`local://gajae-style-feasibility.md:68-89`).
- 따라서 immediate delivery는 owned skill-surface cutover를 먼저 ship하고, bootstrap-level parity는 explicit secondary track으로 추적한다.

## Acceptance criteria
1. workflow-skill ownership의 default-on mainline은 effective `skills.includeSkills = ["pi-oven:*"]`이며, ownership success는 visible workflow skill surface가 pi-oven-only인지로 판정된다.
2. empty `~/.claude/skills` insufficiency와 `claude-plugins` / namespaced marketplace skill caveat가 문서/상태표시/테스트 계약에 명시된다.
3. `--isolate`와 `--suppress-sibling-skills`는 compatibility aids로만 문서화되며, strict ownership의 canonical path로 주장되지 않는다.
4. bootstrap-level gajae parity가 immediate mainline과 분리된 secondary OMP/architecture track으로 명시된다.
5. setup truth는 routing state 기준으로 판정되고, 실제 routing/prereq가 살아 있을 때 false global `✗`가 제거된다.
6. duplicate setup warning은 동일 repo/session start 기준 한 번만 보인다.
7. autonomy stop state는 blocked reason + next action + same-repo/branch resume target을 durable하게 남기고 restart 후 재사용한다.
8. branch contract, approval handoff, exact owned skill read proof gate는 autonomy parity 이후에도 완화되지 않는다.
9. `pi-oven_ask`는 question/context/detail spacing을 유지하면서 선택지 사이 extra blank line만 제거한다.
10. workflow-skill-only scope가 문서/테스트/runtime에서 일관되게 유지되고, commands/agents/hooks/MCP servers exclusivity로 scope creep하지 않는다.

## Open questions
1. **OPEN-1 — loaded skill-surface observation contract**  
   `skills.includeSkills = ["pi-oven:*"]` 적용 이후 실제 loaded/visible workflow skill surface를 runtime과 doctor가 어떤 API 또는 probe로 authoritative 하게 관찰할지 implementation에서 확정해야 한다.
2. **OPEN-2 — bootstrap parity shape**  
   secondary OMP/architecture track의 정답이 provider bootstrap allowlist인지, native-mirror architecture인지, bundled/native skill registration API인지 아직 확정되지 않았다.
3. **OPEN-3 — duplicate emission attribution signal**  
   duplicate setup warning의 근본 원인이 host-side double `session_start`인지, extension multi-load인지, 둘 다 가능한지 식별할 수 있는 host signal이 있는지 아직 불명확하다. signal이 없다면 repo-local dedupe guard가 canonical 대응이 된다.
4. **OPEN-4 — autonomy resume payload shape**  
   `autonomous.json` 안에 ownership status / blocked reason / next action / resume target을 어느 nested shape로 canonicalize할지는 implementation에서 확정해야 한다. 다만 same repo / same branch restart와 durable blocked reason 보존은 고정 요구사항이다.
