# Plan: pi-oven-setup option-C model-override rewrite

**Status**: ## Frozen — codex plan-review PASS (🔴8 → 🔴2 → 🔴0, cycle 3, 2026-05-29). Ready for sonnet executor dispatch.
**Spec (FROZEN contract)**: `docs/specs/2026-05-29-pi-oven-user-local-override.md` (v3, 🔴0 PASS)
**Audit (codebase survey)**: `docs/harness/surveys/2026-05-29-pi-oven-setup-stale-audit.md`
**Cycle verdicts**: `docs/research/codex-reviews/pi-oven-user-local-override-critic-review-{2,3}.md`
**Date**: 2026-05-29

---

## Goal

옵션 C 를 구현한다: per-role agent 모델 override 를 **user-global `~/.omp/agent/config.yml` 의 `task.agentModelOverrides` (colon key `pi-oven:<role>`)** 에 기록하여 omp 의 실제 모델 해소 경로(`task/index.ts:648-657` → `resolveAgentModelPatterns`)와 처음으로 연결한다. 동시에 spec §2 가 진단한 dead 경로(`settings.pi-oven` plugin-config transport, committed `agents/pi-oven-*.md` rewrite, session_start drift 허구 경고) 를 전수 제거한다. 결과 불변식: (a) repo git tree 무변경, (b) CI lint fail 없음, (c) PR diff 오염 없음, (d) default bump 시 release-noise 없음 (spec §1). lint 삼각형(profiles.ts → frontmatter → lint)은 committed PROFILE_A baseline 으로 유지하고, override layer 는 repo 밖 user-global 로 분리한다(spec §4, AC#5).

---

## Transport decision

**채택: OMP-DELEGATED read-merge-set-whole-record (`omp config get` → in-memory merge → `omp config set task.agentModelOverrides '<whole-json>'`).** omp 가 직렬화·atomicity·lock·config.yml path 를 모두 소유한다. pi-oven 는 lock/temp/rename 을 직접 구현하지 않는다.
**기각 1: spec §3.1(c) 의 PREFER `omp config set task.agentModelOverrides.pi-oven:<role> <model>` (dotted per-key set)** — CLI key-validation 이 거부.
**기각 2: 직접 YAML read-merge-write + custom file-lock + temp+rename** — pi-oven 의 custom lock 은 omp 의 writer(agent-dashboard 등)와 coordinate 못함(별도 lock 도메인), temp-dir cross-device(EXDEV) rename 위험, omp config.yml comment/format churn. omp-delegated 가 이 전부를 회피.

### 메커니즘 (3-step, 모든 write/delete task 공통)

1. **read**: `omp config get task.agentModelOverrides --json` → `value` 필드 = 현재 record (JSON object). parse.
2. **merge (in-memory, pi-oven 책임)**: 단일 `pi-oven:<role>` 키를 set(override/import) 또는 `/^pi-oven:/` 키 전부 delete(reset). **형제 키(비-pi-oven:* + 다른 pi-oven:*) 는 pi-oven 의 merge 가 그대로 보존** — read 한 record 에서 해당 키만 추가/삭제하고 나머지는 복사.
3. **write**: `omp config set task.agentModelOverrides '<merged-whole-json>'` → omp 가 config.yml 에 기록(omp 의 path/atomicity/serialization/lock). whole-record replace 이지만 step 2 가 형제 키를 이미 포함하므로 lost-data 없음.

### read step FAIL-CLOSED (data-loss guard, Pc2-1)

whole-record set 은 record 전체를 replace 하므로, 형제 override 가 있는데 read 가 잘못 `{}` 를 돌려주면 set 이 형제를 **wipe** 한다. 따라서 read 는 **fail-closed** 로 두 경우를 엄격 구분한다:

- **(i) key genuinely absent / empty record** → `{}` 에서 시작(merge+set 진행 안전). 판정 기준: get exit 0 AND 출력이 expected shape 로 parse 됨 AND `.value` 가 object(`{}` 포함).
- **(ii) parse 실패 / non-zero exit / unexpected shape** (출력이 JSON parse 불가, `.value` 필드 부재, `.value` 가 object 아님, `.type !== "record"`) → **전체 command ABORT**(명확한 에러, exit 1). **절대 `{}` 로 merge 후 set 호출 금지** — 형제 wipe 방지.

expected get shape (read-only 확인): `omp config get task.agentModelOverrides --json` → `{"key":"task.agentModelOverrides","value":<record-object>,"type":"record","description":<string>}` (exit 0). strict guard 는 이 shape 가 아니면 (ii) 로 분류해 abort. (`--json` 없이 get 하면 `{}` 같은 비구조 출력 — write 경로는 **반드시 `--json` 사용**하여 shape 검증.)

### 검증 근거 (live, 비파괴 — config.yml 미변경)

| 검증 | 명령 / 출처 | 결과 |
|---|---|---|
| whole-record get | `omp config get task.agentModelOverrides --json` | `{"key":"task.agentModelOverrides","value":{},"type":"record","description":""}` — parseable, `value` = record. read step 신뢰 가능 |
| whole-record set 동작 (reason, NO mutation) | `cli/config-cli.ts` handleSet `case "record"`: `parsed = JSON.parse(trimmed)`; `if (parsed===null \|\| typeof!=="object" \|\| Array.isArray) throw "Invalid record JSON"`; `settings.set(path, parsedValue)` | `omp config set task.agentModelOverrides '<json>'` 은 선언된 top-level key → JSON object 를 통째로 `settings.set` → **record 전체 replace**. 따라서 step 2 merge 가 형제 키를 반드시 포함해야 함(메커니즘에 반영됨) |
| dotted colon leaf get (기각1 근거) | `omp config get task.agentModelOverrides.pi-oven:critic` | `Unknown setting` (exit 1). `config-cli.ts:49,53` 가 전체 key 를 `SETTINGS_SCHEMA` 선언 key 와 대조 → dotted child 는 `settings.set` 의 `setByPath` 도달 전 거부 |
| config.yml 경로 | `omp config path` → `~/.omp/agent`; key = `task.agentModelOverrides` (record, default `{}`) | 확인 |

### get→set race (문서화, 수용)

read 와 set 사이에 다른 writer 가 동일 key 를 갱신하면 lost-update 가 가능하다. 본 plan 은 이를 **수용**한다: (a) override write 는 개인·single-user CLI 의 명시적 user action(동시 실행 비현실적), (b) 이 race window 는 omp 자신의 agent-dashboard writer 가 가지는 것과 동일한 도메인 — pi-oven 가 custom lock 을 추가해도 omp writer 와 coordinate 못하므로 race 를 실제로 줄이지 못함, (c) omp `config set` 자체의 write 는 omp lock 으로 atomic. → custom lock 미도입.

### 결정의 결과 (모든 write/delete task 에 적용)

- 모든 write 는 `spawnFn("omp", ["config","get","task.agentModelOverrides","--json"])` → parse → merge → `spawnFn("omp", ["config","set","task.agentModelOverrides", JSON.stringify(merged)])`.
- 테스트 격리: 주입된 `spawnFn` (현 `PI_OVEN_MOCK_SPAWN` / spawnFn 패턴 계승)으로 get/set 호출을 mock — get 은 fixture record 반환, set 은 args[3] (whole-json) 캡처해 검증. live omp 호출·실제 config.yml 변경 없이 unit 검증.
- merge 함수는 **순수 함수**로 분리(아래 Task 1.1 `mergeOverrideRecord`) — get/set IO 와 무관하게 형제-보존 로직 단위 테스트.

---

## Dependencies

```
Wave 1 (transport core: config-yml helper + validator)  ── precedes ──▶  Wave 2 (flags)
Wave 2 (apply/override/reset/import/status + dead-flag 제거)  ── precedes ──▶  Wave 3 (extension + lint)
Wave 4 (docs/stale)  ── file-disjoint, mechanical; 어느 wave 와도 병렬 가능 (단 PROFILE_A 의 옵션C 의미 확정 후 권장 = Wave 1 이후)
```

- **Wave 1 → Wave 2**: Wave 2 의 모든 flag 가 Wave 1 의 `config-yml.ts` write/read/delete helper + `model-id-validator.ts` 를 import.
- **Wave 2 → Wave 3 (spec §9 정정, codex PBc2-2)**: Wave 3 의 extension drift 제거와 lint colon-name invariant 는 `agent-rewriter.ts` 의 wizard-경로 제거/maintainer-경로 한정 계약을 공유. 이 계약이 Wave 2 에서 확정되어야 Wave 3 가 안전. **병렬 아님 — 순차.**
- **Wave 4**: I5/I7/I8 + models.yml 삭제. 코드 경로와 file-disjoint. executor haiku 가능(일부 sonnet). spec §9.

---

## Execution waves

각 wave: executor(sonnet) dispatch, TDD strict (red→green→refactor), wave 합류 review, 최종 fresh-agent verifier. 코드 품질 공통 계약(모든 task): DRY/YAGNI/KISS, **deletion-first**(이 cycle 은 dead code 대량 삭제 — shim 보다 삭제 우선), obsolete test 제거, depth(얕은 wrapper 금지).

---

## Wave 1 — Transport core (TDD)

### Task 1.1 — `config-yml.ts` 신규: task.agentModelOverrides read/merge-write/delete helper

- **File (신규)**: `scripts/pi-oven-setup/config-yml.ts`
- **File (test, 신규)**: `tests/scripts/pi-oven-setup/config-yml.test.ts`
- **DELETE 대상 (이 task 가 대체)**: `scripts/pi-oven-setup/persist.ts` 전체 — `writePluginConfig`/`deletePluginConfig`/`readPluginConfig` 는 model-data 용도가 0 (전부 dead namespace). persist.ts 와 `tests/scripts/pi-oven-setup/persist.test.ts` 를 삭제하고 config-yml.ts 로 대체. (다른 모듈의 persist import 는 Wave 2 에서 교체되므로 Wave 1 에서 persist.ts 삭제 시 일시적 컴파일 실패 → **Wave 1 에서는 persist.ts 를 남기되 deprecated 주석만 달고, 실제 삭제는 Wave 2 의 마지막 task 에서 import 0 확인 후 수행**. 아래 Split rationale 참조.)

- **Imports**: 없음 (node fs / os / path 불필요 — config.yml 직접 read/write 안 함). 모든 IO 는 주입된 `spawnFn` 으로 `omp config get/set` 호출. record JSON 파싱은 `JSON.parse`.

- **추가할 함수 시그니처**:
  ```ts
  export interface ConfigYmlOpts {
    /** Injectable spawn for omp config get/set (tests). Default: Bun.spawnSync wrapper. */
    spawnFn?: (cmd: string, args: string[]) => { exitCode: number | null; stdout?: Buffer; stderr?: Buffer };
  }

  /**
   * PURE merge helper (no IO). Given the current record + a mutation, return the new record.
   * - op "set": returns { ...current, [colonKey]: model }
   * - op "delete-pi-oven": returns current with every /^pi-oven:/ key removed
   * Preserves all sibling keys (non-pi-oven:* and other pi-oven:*) by construction. Unit-tested without spawn.
   */
  export function mergeOverrideRecord(
    current: Record<string, string>,
    mutation: { op: "set"; colonKey: string; model: string } | { op: "delete-pi-oven" }
  ): Record<string, string>;

  /**
   * STRICT read for the WRITE path (fail-closed, Pc2-1). Spawns `omp config get task.agentModelOverrides --json`.
   * Returns a discriminated result — callers MUST distinguish absent from corrupt:
   *   - { ok: true, record }  → get exit 0 AND output parsed to expected shape
   *       ({ key, value, type:"record", description }) AND value is an object. record = value (empty {} = genuinely-absent/fresh, safe).
   *   - { ok: false, error }  → non-zero exit, JSON.parse failure, missing/`.value` not object, OR `.type !== "record"`.
   *       Callers MUST ABORT (never merge-into-{} then set — would wipe siblings).
   */
  export async function readOverridesStrict(
    opts?: ConfigYmlOpts
  ): Promise<{ ok: true; record: Record<string, string> } | { ok: false; error: string }>;

  /**
   * GRACEFUL read for the DISPLAY path only (status). Returns {} on any error/absent.
   * MUST NOT be used by write paths (set/delete) — display tolerates {} (shows "no override"),
   * but a write that merges into a wrongly-empty {} would wipe siblings.
   */
  export async function readAgentModelOverrides(
    opts?: ConfigYmlOpts
  ): Promise<Record<string, string>>;

  /**
   * SET one override: readOverridesStrict → if !ok ABORT(throw) → mergeOverrideRecord(set) → `omp config set ... '<json>'`.
   * colonKey MUST be "pi-oven:<role>"; model a single id. Throws on non-pi-oven colonKey, on strict-read !ok, or on set non-zero exit.
   */
  export async function setAgentModelOverride(
    colonKey: string,
    model: string,
    opts?: ConfigYmlOpts
  ): Promise<void>;

  /**
   * DELETE all /^pi-oven:/ keys: readOverridesStrict → if !ok ABORT(throw) → mergeOverrideRecord(delete-pi-oven) → `omp config set ...`.
   * Returns the sorted list of removed colon keys. Preserves non-pi-oven:* keys. Throws on strict-read !ok or set non-zero exit.
   */
  export async function deletePiOvenAgentModelOverrides(
    opts?: ConfigYmlOpts
  ): Promise<string[]>;
  ```

- **Edge cases (fail-closed, Pc2-1)**:
  - **(i) genuinely-absent/fresh**: get exit 0 + expected shape + `value:{}` → `readOverridesStrict` returns `{ok:true, record:{}}` → set 은 `{ [colonKey]: model }` 1키 record. 안전.
  - **(ii) corrupt/unexpected** — get non-zero exit, unparseable JSON, `.value` 부재/object 아님, `.type !== "record"` → `readOverridesStrict` returns `{ok:false}` → setAgentModelOverride / deletePiOvenAgentModelOverrides **throw, set 절대 미호출** (형제 wipe 방지). write 경로는 `--json` 필수(shape 검증).
  - 형제 키 보존: strict-read record 에 비-pi-oven(`claude-code:foo`) 또는 다른 pi-oven:* 키 → `mergeOverrideRecord` 가 그대로 복사.
  - `colonKey` 가 `pi-oven:` 로 시작 안 하면 setAgentModelOverride throw (방어).
  - `omp config set` non-zero exit → throw (write 실패 surface).
  - record value 의 개별 항목이 string 이외(이론상) → shape guard 는 value-가-object 까지만; 항목 타입은 schema(Record<string,string>) 신뢰, String() 강제.

- **Test names + assertion shape** (`config-yml.test.ts`) — 전부 주입 spawnFn, live omp 無:
  - test: "mergeOverrideRecord set adds key, preserves siblings" — `merge({"claude-code:foo":"m","pi-oven:executor":"e"}, {op:"set",colonKey:"pi-oven:critic",model:"X"})` === `{"claude-code:foo":"m","pi-oven:executor":"e","pi-oven:critic":"X"}` (PURE, no spawn).
  - test: "mergeOverrideRecord set overwrites existing same key" — `merge({"pi-oven:critic":"old"},{op:"set",colonKey:"pi-oven:critic",model:"new"})["pi-oven:critic"]==="new"`.
  - test: "mergeOverrideRecord delete-pi-oven removes only pi-oven:* " — `merge({"pi-oven:critic":"a","pi-oven:executor":"b","claude-code:foo":"m"},{op:"delete-pi-oven"})` === `{"claude-code:foo":"m"}` (AC#2).
  - test: "readOverridesStrict ok:true on expected shape" — get→`{"key":"task.agentModelOverrides","value":{"pi-oven:critic":"X"},"type":"record","description":""}` exit 0; assert `{ok:true, record:{"pi-oven:critic":"X"}}`.
  - test: "readOverridesStrict ok:true record:{} on fresh empty" — get→`{...,"value":{},"type":"record"}` exit 0; assert `{ok:true, record:{}}` (genuinely-absent = safe).
  - **test (Pc2-1): "readOverridesStrict ok:false on malformed JSON"** — get exit 0 stdout `"not json{{{"`; assert `{ok:false}`.
  - **test (Pc2-1): "readOverridesStrict ok:false on missing .value"** — get→`{"key":"x","type":"record"}` (no value); assert `{ok:false}`.
  - **test (Pc2-1): "readOverridesStrict ok:false on .value not object"** — get→`{"value":"oops","type":"record"}`; assert `{ok:false}`.
  - **test (Pc2-1): "readOverridesStrict ok:false on type != record"** — get→`{"value":{},"type":"string"}`; assert `{ok:false}`.
  - test: "readOverridesStrict ok:false on get non-zero exit" — get exitCode 1; assert `{ok:false}`.
  - test: "setAgentModelOverride calls get then set with merged whole-json" — get→`{"value":{"claude-code:foo":"m"},"type":"record"}`; assert set called with args `["config","set","task.agentModelOverrides", JSON.stringify({"claude-code:foo":"m","pi-oven:critic":"anthropic/claude-opus-4-8"})]` (parsed JSON equals expected) (AC#1/#2 transport).
  - **test (Pc2-1): "setAgentModelOverride ABORTS on corrupt get — set NOT called, no data-loss"** — get exit 0 stdout malformed JSON; assert setAgentModelOverride rejects AND mock spawnFn NEVER called with `["config","set",...]` (config unchanged).
  - test: "setAgentModelOverride throws when get exits non-zero — set NOT called" — get exitCode 1; assert rejects AND set never called.
  - test: "setAgentModelOverride throws when omp config set exits non-zero" — set returns exitCode 1; assert rejects.
  - test: "setAgentModelOverride throws on non-pi-oven colonKey" — `set("claude-code:x","m")` rejects; set spawn never called.
  - test: "deletePiOvenAgentModelOverrides sets merged record without pi-oven:* and returns removed keys" — get→`{"value":{"pi-oven:critic":"a","pi-oven:executor":"b","claude-code:foo":"m"},"type":"record"}`; assert returned === `["pi-oven:critic","pi-oven:executor"]` (sorted) AND set called with JSON === `{"claude-code:foo":"m"}` (AC#2).
  - **test (Pc2-1): "deletePiOvenAgentModelOverrides ABORTS on corrupt get — set NOT called"** — get malformed; assert rejects AND no set spawn.
  - test: "readAgentModelOverrides (graceful) parses .value from --json" — get→`{"value":{"pi-oven:critic":"X"},"type":"record"}`; assert `{"pi-oven:critic":"X"}`.
  - test: "readAgentModelOverrides (graceful) returns {} on get non-zero exit / malformed" — assert `{}` (display tolerance only).

- **DO NOT**: config.yml 직접 read/write 금지(omp 가 소유). custom file-lock / temp-write / rename 금지. dotted-path set 금지. **write 경로(set/delete)에서 graceful `readAgentModelOverrides` 사용 금지 — 반드시 `readOverridesStrict` + fail-closed abort** (corrupt get 을 `{}` 로 merge 후 set 하면 형제 override wipe = data-loss).

### Task 1.2 — `model-id-validator.ts` 신규: EXACT-ID-ONLY resolver-parity 검증

- **File (신규)**: `scripts/pi-oven-setup/model-id-validator.ts`
- **File (test, 신규)**: `tests/scripts/pi-oven-setup/model-id-validator.test.ts`

- **Imports**: 없음 — pure parser 는 input string 만. CLI wrapper 만 `Bun.spawnSync` (또는 주입 spawnFn).

- **검증 메커니즘 (1개로 핀 — spec §3.5 / codex Bc2-3)**: `omp --list-models` 의 **"Canonical models"** 섹션(첫 줄 `Canonical models` ~ 첫 빈 줄; 확인: 빈 줄=line 69, `Provider models`=line 70)에서 `selected` 컬럼(2번째 토큰, `provider/model-id` 형태 — 66 rows 확인)을 추출해 **resolvable exact-id 집합**을 만든다. override 값이 이 집합에 **정확히** 멤버이면 valid. omp resolver 가 canonical 테이블로 해소하는 것과 동일 의미론(resolver parity), glob/prefix/wildcard 없음(EXACT-ID-ONLY).
  - **rejected 대안 1 (문서화)**: `model-resolver.ts:274 findExactModelReferenceMatch(ref, availableModels)` 직접 import. resolver-parity 최강이나 `availableModels` 를 얻으려면 `ModelRegistry.getAll()` 인스턴스 + `Settings` 구성 필요 — CLI 스크립트에서 omp 내부 객체 graph 구성은 무겁고 bun-build 경로 해석 위험(pi-oven.ts self-contained 선례와 모순). → 기각.
  - **rejected 대안 2 (spec §3.5 명시 금지)**: `auth-detect.ts:14,56` provider-row parser 재사용. resolver parity 없는 단순 행 파서 → valid id 오분류. → **금지**.

- **테스트 seam 핀 (codex Bc-2)**: 검증을 **PURE parser fn + thin CLI wrapper** 로 분리. parser 는 raw text → `string[]` 로 subprocess 無 단위 테스트(fixture string 직접 주입). wrapper 만 spawn. wrapper 테스트가 필요하면 env `PI_OVEN_LIST_MODELS_FIXTURE=<path>` 로 fixture 주입(wrapper 가 이 env 있으면 spawn 대신 파일 read).

- **추가할 함수 시그니처**:
  ```ts
  export interface ModelIdValidatorOpts {
    /** Injectable `omp --list-models` stdout (tests, highest precedence). */
    listModelsOutput?: string;
    /** Injectable spawn (tests). */
    spawnFn?: (cmd: string, args: string[]) => { exitCode: number | null; stdout?: Buffer; stderr?: Buffer };
  }

  /**
   * PURE parser. Input: raw `omp --list-models` text. Output: canonical "provider/model-id" ids.
   * Defensive: THROWS if the "Canonical models" header line or its column header (`canonical  selected ...`)
   * is absent (fail loud on format drift — do not silently return []).
   */
  export function parseCanonicalModelIds(listModelsOutput: string): string[];

  /**
   * Thin wrapper: obtains text via (a) opts.listModelsOutput, else (b) $PI_OVEN_LIST_MODELS_FIXTURE file,
   * else (c) spawn `omp --list-models`. Then parseCanonicalModelIds → Set membership (EXACT-ID-ONLY).
   * No glob/prefix/wildcard.
   */
  export async function isResolvableModelId(
    model: string,
    opts?: ModelIdValidatorOpts
  ): Promise<boolean>;
  ```

- **Edge cases**:
  - 헤더 행(`canonical  selected  variants ...`)은 selected 토큰에 `/` 없음 → skip.
  - "Provider models" 섹션(첫 빈 줄 이후)은 파싱 안 함.
  - 빈 줄에서 canonical 섹션 종료.
  - trailing whitespace / 가변 컬럼 폭 → `split(/\s+/)` 정규화.
  - **format drift**: `Canonical models` 헤더 또는 column-header 행 부재 → `parseCanonicalModelIds` THROW("unexpected omp --list-models format"). 호출측(override/import)이 이 throw 를 명확한 에러로 표면화하고 write 거부 — 빈 집합 silent 허용 시 모든 valid id 가 거부되어 오인 가능하므로 loud-fail.
  - `omp --list-models` spawn 실패(빈/에러 출력) → parser throw (위와 동일).

- **Test names + assertion shape**:
  - test (PURE): "parseCanonicalModelIds extracts provider/model-id from fixture" — fixture string (header + 3 rows incl `anthropic/claude-opus-4-8`, `openai-codex/gpt-5.3-codex`); assert array contains both, length === row count. No subprocess.
  - test (PURE): "parseCanonicalModelIds skips column-header row and Provider-models section" — assert result excludes literal `selected` and bare `claude-opus-4-8` (no slash).
  - test (PURE): "parseCanonicalModelIds throws when 'Canonical models' header absent" — input `"random text\n"`; assert throws (defensive, format-drift loud-fail).
  - test (PURE): "parseCanonicalModelIds throws when column-header row absent" — `"Canonical models\n\nProvider models\n"`; assert throws.
  - test (wrapper): "isResolvableModelId true for exact canonical id" — `{listModelsOutput: fixture}` → `isResolvableModelId("anthropic/claude-opus-4-8")` true.
  - test (wrapper): "isResolvableModelId false for retired id" — `anthropic/claude-opus-4-7` not in fixture → false (NEGATIVE, AC#3b).
  - test (wrapper): "isResolvableModelId false for pattern-like input" — `anthropic/claude-*` → false (EXACT-ID-ONLY).
  - test (wrapper): "isResolvableModelId false for bare canonical (no provider)" — `claude-opus-4-8` → false.
  - test (wrapper): "isResolvableModelId surfaces parser throw on empty output" — `{listModelsOutput:""}` → rejects/throws (not silent false).

#### Split rationale (Wave 1)
Wave 1 = 2 task: 1.1(transport, omp-delegated get/merge/set + pure mergeOverrideRecord) 과 1.2(validator, pure parser + thin wrapper) 는 관심사 분리·독립 테스트 가능. persist.ts 실제 삭제는 import 0 보장 위해 Wave 2 마지막(2.6)으로 미룸 — Wave 1 에서 삭제하면 status/apply/import/reset/reapply 가 persist 를 아직 import 하여 `tsc --noEmit` red. deletion-first 유지하되 삭제 시점만 시퀀스.

---

## Wave 2 — Flag rewire (TDD, depends Wave 1)

### Task 2.1 — dispatcher `pi-oven-setup.ts` 재배선: override-first route + dead flag 제거

- **File**: `scripts/pi-oven-setup.ts`
- **File (test)**: `tests/scripts/pi-oven-setup-cli.test.ts` (갱신)

- **Anchor (현재 코드)**:
  - `:38` `"confirm-auth": { type: "boolean", default: false },` → **삭제** (I4; auth-detect.ts:109 `confirmAuthViaPing` 도 미사용 시 삭제 — Wave 2 Task 2.5 에서 grep 확인 후).
  - `:79-80` `} else if (values.reapply) { result = await runReapply(...)` → **삭제** (A5/§3.3 reapply retire). import `runReapply` (`:20`) 삭제.
  - `:81` `} else if (values.profile || values.apply) {` — A|B 검증(`:83-88`)은 **유지**(spec §3.3 custom row: dispatcher A|B reject 로직 유지, "custom" 값만 CLI 에서 제거). `--profile custom` 은 이미 reject 되므로 코드 변경 없이 doc 만 동기(Wave 4 I5).
  - `:90-109` `--override` 파싱 + runApply 호출 — **재작성**: override 는 더 이상 apply 로 가지 않음.
  - `:110-114` `else { "No action specified" }` — **override standalone 케이스 제외**(Bc2-1/§3.3).

- **새 dispatch 구조 (spec §3.3 + §3.4 flag 결합 우선순위)**:
  - `--override` 가 1개 이상 값과 함께 존재 → override-write route (아래 우선순위).
  - **결합 우선순위 (§3.4, codex c3)**: `--override` 는 `--status`/`--validate` 와만 결합 가능. 결합 시 override-write 선적용 후 status/validate. `--override` + (`--apply`|`--import`|`--reset`) = 상호배타 → 명확한 에러 + exit 1.
  - 단독 `--override` (다른 action flag 없음) → override-write 후 exit 0 (no "No action specified").
  - precedence: `--status > --reset > --import > (--profile|--apply maintainer) > standalone --override`. 단 `--override` + `--status` 결합은 status 분기 안에서 먼저 write.

- **추가할 함수/로직 시그니처** (dispatcher 내부 또는 신규 `scripts/pi-oven-setup/override.ts`):
  ```ts
  // scripts/pi-oven-setup/override.ts (신규, 권장 — dispatcher 비대화 방지)
  export interface OverrideOptions {
    /** Raw "role=model" entries from --override (repeatable). */
    entries: string[];
    /** Injectable list-models output for validator (tests). */
    listModelsOutput?: string;
    /** Injectable spawn for config-yml get/set (tests). */
    spawnFn?: (cmd: string, args: string[]) => { exitCode: number | null; stdout?: Buffer; stderr?: Buffer };
  }
  /**
   * For each "role=model": parse (must contain "="; non-empty role+model), validate role ∈ ROLES,
   * validate model resolvable (EXACT-ID-ONLY). Validate ALL entries FIRST; only if all pass,
   * write each via setAgentModelOverride("pi-oven:"+role, model). Any invalid → exit 1, ZERO writes.
   * Returns per-entry result for status echo.
   */
  export async function runOverride(
    opts: OverrideOptions
  ): Promise<{ exitCode: number; output: string; applied: Array<{ colonKey: string; model: string }> }>;
  ```

- **Edge cases (DECISIVE — Bc-1)**:
  - malformed `--override` entry — `=` 없음 (`critic`), 빈 role (`=model`), 빈 model (`critic=`) → **ERROR + exit 1, ZERO writes** (skip 아님). 명확한 메시지: "invalid --override '<entry>': expected <role>=<model>".
  - role ∉ ROLES → ERROR + exit 1, ZERO writes. **부분 write 금지**: 모든 엔트리 검증 통과 후에만 일괄 write (validate-all-then-write-all).
  - model 미해소(isResolvableModelId false) → ERROR "override <role>=<model> 미해소 — write 거부" + exit 1, ZERO writes.
  - `--override` 반복 → 전부 검증 후 순차 MERGE write.
  - hyphen 토큰 → colon: `code-reviewer` → `pi-oven:code-reviewer` (role 이 하이픈 포함; `pi-oven:` + role 그대로).

- **Test names + assertion shape** (`pi-oven-setup-cli.test.ts` 갱신; 주입 spawnFn + list-models fixture):
  - test: "standalone --override critic=<model> sets config via omp and exits 0 (not 'No action specified')" — run `["--override","critic=anthropic/claude-opus-4-8"]` with mock spawnFn (get→`{}`, set captures json) + injected list-models fixture; assert exitCode 0 AND captured `omp config set task.agentModelOverrides` json parsed `["pi-oven:critic"]==="anthropic/claude-opus-4-8"` AND stdout !~ /No action/ (AC#1).
  - test: "standalone --override does not modify tracked baseline files" — run in repo cwd; assert `git status --short -- agents/ scripts/` empty (NO change to tracked baseline; whole-tree clean NOT asserted — workspace may have other untracked files) AND `~/.omp/plugins/omp-plugins.lock.json` untouched (assert never spawned `omp plugin config`) (AC#1, Bc-7).
  - test: "two --override entries both persist (MERGE)" — `["--override","critic=X","--override","executor=Y"]` (X,Y resolvable); assert final captured set-json has both colon keys (AC#2).
  - test: "--override with retired model id rejects (exit 1, no set call)" — `critic=anthropic/claude-opus-4-7` not in fixture; assert exitCode 1 AND mock spawnFn never called with `["config","set",...]` (AC#3b).
  - **test (Bc-1): "malformed --override critic (no '=') exits 1, no set call"** — `["--override","critic"]`; assert exitCode 1 AND error ~ /expected.*=.*model/ AND no `config set` spawn (config unchanged).
  - test (Bc-1): "--override =model (empty role) exits 1, no write" — `["--override","=anthropic/claude-opus-4-8"]`; assert exitCode 1, no set call.
  - test (Bc-1): "--override unknownrole=X (role ∉ ROLES) exits 1, no write" — assert exitCode 1, no set call.
  - test: "--override + --reset is mutually exclusive (exit 1)" — assert exitCode 1, error mentions mutual-exclusive, no writes.
  - test: "--override + --status applies override then shows updated effective model" — assert set called THEN status output shows override value (§3.4).
  - **test (PB §3.4): "--override + --validate applies override then runs validate"** — `["--override","critic=<resolvable>","--validate","none"]`; assert set called first (config write happened) THEN validate path ran (exit reflects validate outcome; with `--validate none` exit 0). Order: write-before-validate.
  - test: "no action + no override exits 1 with usage" — `[]` → exit 1 (usage 문구에서 --reapply 제거).
  - **삭제할 기존 test**: "--reapply with pi-oven.profile=B: exits 0" (reapply retired).
  - **갱신**: "no action flag" usage regex 에서 `--reapply` 제거.

- **DO NOT**: `--override` 를 `runApply` 로 라우팅 금지. agent-rewriter 호출 금지. plugin-config write 금지. malformed entry skip 금지(반드시 exit 1). 부분 write 금지.

### Task 2.2 — `apply.ts` 재작성: maintainer-generate 전용, dead write loop 제거

- **File**: `scripts/pi-oven-setup/apply.ts`
- **File (test)**: `tests/scripts/pi-oven-setup/apply.test.ts` (갱신)

- **Anchor (현재)**:
  - `:6` `import { writePluginConfig } from "./persist"` → **삭제**.
  - `:48-60` dead per-role plugin-config write loop (pi-oven.profile + 23×3 키) → **전부 삭제** (A1).
  - `:62-65` `if (opts.agentsDir) rewriteAllAgents(...)` → **유지하되 의미 한정**: `--apply --profile A|B` 는 spec §3.3 에서 **maintainer-전용 generate** (profiles.ts → repo agents/, lint baseline 생성)로 한정. personal `--override` 는 절대 이 경로 안 탐. apply.ts 는 (a) profileMap 해소 (b) agentsDir 주어지면 rewriteAllAgents (c) validate 만 남김.

- **추가/변경 시그니처**: `ApplyOptions` 에서 `overrides?` 필드 제거(override 는 Task 2.1 의 runOverride 로 분리). `runApply` 는 maintainer generate + validate 만.
  ```ts
  export interface ApplyOptions {
    profile: "A" | "B";
    validateMode?: "smoke" | "full" | "none";
    spawnFn?: (cmd: string, args: string[]) => { exitCode: number | null; stdout?: Buffer; stderr?: Buffer };
    agentsDir?: string; // maintainer generate target (repo agents/)
  }
  ```

- **Edge cases**:
  - agentsDir 미지정 → rewrite skip (validate only). maintainer 가 명시적으로 줄 때만 generate.
  - `lockFilePath` 옵션 제거(plugin-config 미사용).

- **Test names + assertion shape** (`apply.test.ts` 갱신):
  - test: "runApply does NOT call any plugin-config write" — spy spawnFn; assert no call with args including "plugin","config","set".
  - test: "runApply with agentsDir generates Profile A frontmatter (maintainer path)" — assert agent files match PROFILE_A (existing rewriteAllAgents 동작 유지).
  - test: "runApply without agentsDir runs validate only, no file mutation" — assert agents dir untouched.
  - **삭제할 기존 test**: per-role plugin-config write 호출 수 검증 test (dead).

- **DO NOT**: pi-oven.profile / pi-oven.models.* plugin-config write 금지. override 처리 금지(분리됨).

### Task 2.3 — `status.ts` 재작성: 실제 effective model + source, dead drift 제거

- **File**: `scripts/pi-oven-setup/status.ts`
- **File (test)**: `tests/scripts/pi-oven-setup/status.test.ts` (갱신)

- **Anchor (현재)**:
  - `:6` `import { readPluginConfig } from "./persist"` → `import { readAgentModelOverrides } from "./config-yml"`.
  - `:7` `import { readAgentFiles, detectDrift } from "./agent-rewriter"` → `detectDrift` 삭제, `readAgentFiles` 유지(frontmatter 읽기용).
  - `:20-28` `readPluginConfig` + `pi-oven.profile` gate → 삭제. profile 개념 제거(override 는 profile-less).
  - `:50-62` drift block → **전부 삭제** (A4/§3.3).
  - `:78-99` `buildConfigProfileMap` → 삭제.

- **새 계산 (AC#4, configured effective override)**: 각 role 에 대해 `configured effective = override(pi-oven:<role>) ?? frontmatter model[0]`, source = `override(config.yml)` / `default(frontmatter)`. override 는 `readAgentModelOverrides({spawnFn})` (omp config get) 로 읽음. 이는 **configured precedence** (runtime registry 해소 아님 — precedence 재구현 금지). 미해소 override(isResolvableModelId false)는 경고 행 추가.

- **추가할 함수 시그니처**:
  ```ts
  export interface StatusOptions {
    /** Injectable spawn for omp config get + list-models (tests). */
    spawnFn?: (cmd: string, args: string[]) => { exitCode: number | null; stdout?: Buffer; stderr?: Buffer };
    agentsDir?: string;    // frontmatter source
    listModelsOutput?: string; // for unresolved-override warning (tests)
  }
  export async function runStatus(opts?: StatusOptions): Promise<{ exitCode: number; output: string }>;
  ```

- **Edge cases**:
  - override record 비어있음(omp config get → `{}`) → 모든 role 이 `default(frontmatter)` source.
  - agentsDir 부재 → frontmatter 못 읽음 → override 만 표시, default 는 "(no agent file)".
  - override role 이 ROLES 에 없는 stray colon key → 경고로 표시("unknown role override").
  - 미해소 override → "override <role>=<model> 미해소 — session default 로 fallback 중" 경고(§3.5).
  - scope 표시: "machine-global (~/.omp/agent/config.yml)" 헤더(§3.1 scope).

- **Test names + assertion shape** (`status.test.ts` 갱신, profile-less 로 전면 교체; spawnFn mock 으로 omp config get + list-models 반환):
  - test: "status shows default(frontmatter) source when no override" — spawnFn get→`{value:{}}`; seed agents/ PROFILE_A; assert output contains `critic` + `anthropic/claude-opus-4-8` + "default".
  - test: "status shows override source when override present" — spawnFn get→`{value:{"pi-oven:critic":"opencode-zen/claude-opus-4-8"}}`; assert output shows override value + "override".
  - test: "status warns on unresolved override" — get→`{value:{"pi-oven:critic":"anthropic/claude-opus-4-7"}}`, list-models fixture without it; assert output contains "미해소"/"fallback".
  - test: "status shows machine-global scope header" — assert output contains "machine-global".
  - test: "status has NO drift warning, NO Profile line" — assert output !~ /drift/ AND !~ /Profile [AB] active/.
  - **삭제할 기존 test**: "shows drift warning", "shows Profile A/B when pi-oven.profile", "Profile not configured" (profile 개념 제거).

- **DO NOT**: plugin-config 읽기 금지. drift 계산 금지. runtime registry 해소 호출 금지(configured precedence only). config.yml 직접 read 금지(readAgentModelOverrides → omp config get).

### Task 2.4 — `reset.ts` 재작성: pi-oven:* override 키만 삭제, agent rewrite 제거

- **File**: `scripts/pi-oven-setup/reset.ts`
- **File (test)**: `tests/scripts/pi-oven-setup/reset.test.ts` (갱신)

- **Anchor (현재)**:
  - `:6` `import { deletePluginConfig } from "./persist"` → `import { deletePiOvenAgentModelOverrides } from "./config-yml"`.
  - `:7` `import { rewriteAllAgents } from "./agent-rewriter"` → **삭제**.
  - `:24-33` 71 plugin-config delete 호출 → **삭제**, `deletePiOvenAgentModelOverrides({spawnFn})` 1회로 대체.
  - `:35-38` `rewriteAllAgents(PROFILE_A)` → **삭제** (agent 파일 무변경 — 이미 committed PROFILE_A).

- **시그니처**:
  ```ts
  export interface ResetOptions {
    /** Injectable spawn for omp config get/set (tests). */
    spawnFn?: (cmd: string, args: string[]) => { exitCode: number | null; stdout?: Buffer; stderr?: Buffer };
  }
  export async function runReset(opts?: ResetOptions): Promise<{ exitCode: number; output: string }>;
  ```

- **Edge cases**:
  - override record 비어있음 → 삭제할 키 0, exit 0, "no overrides to clear".
  - 비-pi-oven agentModelOverrides 키 보존(AC#2) — `mergeOverrideRecord(delete-pi-oven)` 가 보장.
  - 출력에 삭제된 role 목록 표시.

- **Test names + assertion shape** (`reset.test.ts` 전면 교체; spawnFn mock):
  - test: "reset removes only pi-oven:* keys, preserves non-pi-oven" — get→`{value:{"pi-oven:critic":"a","claude-code:foo":"m"}}`; assert `omp config set` captured json === `{"claude-code:foo":"m"}` (AC#2).
  - test: "reset does NOT touch agents/ files" — seed agents/, snapshot mtime/content; assert unchanged AND no agent-rewriter call.
  - test: "reset on empty override record exits 0 with no-op message, no set call" — get→`{value:{}}`; assert exitCode 0, output ~ /no overrides|cleared/, no `config set` spawn (또는 동일 빈 record set — 무해; pin: no-op message).
  - **삭제할 기존 test**: "calls deletePluginConfig exactly 71 times", "deletes pi-oven.profile and pi-oven.provider.anthropic.enabled", "deletes all 3 per-role keys", "rewrites all 23 agent files back to Profile A" (전부 dead 동작).

- **DO NOT**: agent 파일 rewrite 금지. plugin-config delete 금지.

### Task 2.5 — `import.ts` 재작성: whitelist per-role model 을 colon key 로 write, agent rewrite 제거

- **File**: `scripts/pi-oven-setup/import.ts`
- **File (test)**: `tests/scripts/pi-oven-setup/import.test.ts` (갱신)

- **Anchor (현재)**:
  - `:8` `import { writePluginConfig } from "./persist"` → `import { setAgentModelOverride } from "./config-yml"`.
  - `:9` `import { rewriteAllAgents } from "./agent-rewriter"` → **삭제**.
  - `:173-185` plugin-config write loop (pi-oven.profile + provider + 23×3) → **삭제**, models 의 각 role.primary 만 colon key 로 setAgentModelOverride (override 의미론과 일치 — import 도 override layer write).
  - `:187-190` rewriteAllAgents → **삭제**.
  - `validateImport` (`:40-118`) — **유지** (whitelist prefix 검증). 단 import 후 추가로 model-id-validator 의 EXACT-ID-ONLY 검증 통과해야 write(§3.5: import 도 setup-time 검증 대상).

- **변경 시그니처**: `RunImportOpts` 에서 `lockFilePath` 제거, `listModelsOutput?` 추가; `spawnFn` 유지(config get/set + validate). `provider`/`profile` 필드는 import 스키마 호환을 위해 파싱은 유지하되 write 안 함(override layer 는 profile-less). `thinkingLevel`/`registry_alternate` 는 schema 가 단일 string 이라 write 대상 아님 — `primary` 만 colon key 로 `setAgentModelOverride` write(§3.1 단일 string 한계, 의도된 한계).

- **Edge cases**:
  - `models` 미포함 import → write 0건, exit 0.
  - primary 가 whitelist 통과했으나 EXACT-ID-ONLY 미해소 → reject (write 0건, exit 1) — **모든 role 검증 후 일괄 write** (부분 write 금지, override 와 동일 정책).
  - registry_alternate/thinkingLevel 는 무시(override layer 미지원) — 출력에 "alternate/thinking ignored (override = single model)" note.

- **Test names + assertion shape** (`import.test.ts` 갱신; `validateImport` test 군 대부분 유지; spawnFn mock):
  - test (validateImport): 기존 9개 유지 (whitelist 로직 불변).
  - test (runImport): "valid import sets pi-oven:executor via omp config" — assert captured `omp config set` json `["pi-oven:executor"] === primary` (replaces old plugin-config assertion).
  - test (runImport): "import does NOT touch agents/ files" — assert no agent-rewriter call, agents/ unchanged.
  - test (runImport): "import rejects whitelisted-but-unresolvable primary (exit 1, no set)" — primary passes prefix but absent from list-models fixture; assert exit 1, no `config set` spawn.
  - **삭제할 기존 test**: plugin-config write 검증, agent rewrite 검증 (있으면).

- **DO NOT**: plugin-config write 금지. agent rewrite 금지. registry_alternate/thinkingLevel write 금지.

### Task 2.6 — dead module + flag 정리 (deletion sweep)

- **Files (삭제)**:
  - `scripts/pi-oven-setup/reapply.ts` + `tests/scripts/pi-oven-setup/reapply.test.ts` (A5/§3.3 retire).
  - `scripts/pi-oven-setup/persist.ts` + `tests/scripts/pi-oven-setup/persist.test.ts` (Task 1.1 Split rationale — 이 시점에 import 0 확인 후 삭제).
- **Files (수정)** — confirmAuthViaPing 제거 (Bc-5, 호출처 0 확인됨: production 0, test 2 cases):
  - `scripts/pi-oven-setup/auth-detect.ts` — `confirmAuthViaPing` (`:109-137`) **삭제** (I4; production caller 0). `detectAuth`/`parseListModelsOutput` 도 production caller 0 확인됨(아래 grep) → **둘 다 삭제 후보**. 단 `detectAuth` 가 dispatcher/Profile-B auth gate 에서 미래 사용 예정인지 확인: 현 스냅샷 grep 0 이므로 **`detectAuth`+`parseListModelsOutput` 도 삭제** (auth-detect.ts 파일 전체 삭제). 만약 Wave 2 진행 중 다른 task 가 detectAuth 를 새로 호출하면(예: Profile-B gate) 그 task 가 명시적으로 살림 — 현 plan scope 에서는 dead → 삭제.
  - `tests/scripts/pi-oven-setup/auth-detect.test.ts` — **수정 또는 삭제**: (a) auth-detect.ts 전체 삭제 시 이 test 파일도 삭제. (b) detectAuth 만 살리는 경우: import 문 `:2` 에서 `confirmAuthViaPing` 토큰 제거(`import { detectAuth } from ...`), `describe("confirmAuthViaPing")` block(`:90-108`, 2 it cases) **삭제**, `:13/:23` 의 opus-4-7 fixture → opus-4-8 (Wave4.3 와 조율). **DO NOT leave dangling test import**: confirmAuthViaPing import 가 남으면 `tsc --noEmit` red.
- **Anchor 확인 (grep, 삭제 전 재확인)**:
  - `grep -rn "from .*persist" scripts/ .omp/` → 0 이어야 persist.ts 삭제.
  - `grep -rn "runReapply\|reapply" scripts/ commands/` → dispatcher/doc 외 0.
  - `grep -rn "confirmAuthViaPing\|detectAuth" scripts/ .omp/ commands/` → (test 제외) 0 확인 후 auth-detect.ts 삭제.

- **Test names + assertion shape**:
  - `tsc --noEmit` clean = persist/reapply/confirmAuthViaPing import 0 의 곧 검증(dangling import 없음).
  - 삭제 후 `bun test` 전체 green + `tsc --noEmit` clean = acceptance.

- **DO NOT**: confirmAuthViaPing import 를 test 에 남긴 채 함수만 삭제 금지(dangling import → tsc red). Wave 2 의 다른 task 가 detectAuth 를 새로 도입하지 않는 한 auth-detect.ts 부활 금지.

#### Split rationale (Wave 2)
6 task 로 분리한 이유: dispatcher(2.1)/apply(2.2)/status(2.3)/reset(2.4)/import(2.5) 는 각각 독립 모듈 + 독립 test 파일이며, 각 task 가 ≤120 lines. 2.6(deletion sweep)은 모든 import 교체 완료 후에만 안전하므로 마지막으로 시퀀스(컴파일 무결성). 2.1 은 신규 `override.ts` 분리로 dispatcher 비대화 방지.

---

## Wave 3 — Extension + lint (TDD, depends Wave 2)

### Task 3.1 — `.omp/extensions/pi-oven.ts` 재작성: session_start drift 제거

- **File**: `.omp/extensions/pi-oven.ts`
- **File (test)**: `tests/extensions/pi-oven.test.ts` (갱신)

- **Anchor (현재)**:
  - `:9` `import type { DriftEntry } from "../../scripts/pi-oven-setup/agent-rewriter"` → **삭제**.
  - `:155-217` `loadProfileMapFromConfig` → **삭제** (A6, dead namespace 읽기).
  - `:219-269` `detectDriftFromMap` → **삭제**.
  - `:288-318` `session_start` 핸들러의 drift block (`:306-317`) → **삭제**. `captureSessionModel` (`:289-304`)은 — **검토**: spec §3.3/§3.4 에 captureSessionModel 명시 제거 없음. parent-session capture 는 auth-fallback 진단용(Spec B §6). spec E 가 명시 삭제 안 했으므로 **유지**(보수적; drift block 만 제거). 단 `pi-oven-session-model.json` 가 dead 인지 grep 확인 → 호출처 0 이면 Wave 4 후속 후보(이 plan scope 밖, open question 으로 기록).
  - `validateAgentRegistry` (`:75-120`) → **유지** (whitelist, AC#6 명시 keep).
  - `:285` `loadProfileMapFromConfig` 용 `lockPath` → drift 제거로 불필요하면 삭제.

- **Edge cases**:
  - session_start 가 captureSessionModel 만 남으면 핸들러 단순화.
  - validateAgentRegistry 는 frontmatter colon-name 검증 추가 안 함(그건 lint-agents.ts 책임, Task 3.2) — 역할 분리 유지.

- **Test names + assertion shape** (`pi-oven.test.ts` 갱신):
  - test: "extension no longer exports loadProfileMapFromConfig/detectDriftFromMap" — `import * as ext`; assert `ext.loadProfileMapFromConfig === undefined` AND `ext.detectDriftFromMap === undefined`.
  - test: "validateAgentRegistry still exported and validates whitelist" — 기존 validateAgentRegistry test 군 유지.
  - **삭제할 기존 test**: `describe("loadProfileMapFromConfig")` 전체 (6 tests), `describe("drift detection")` 전체 (3 tests).
  - **갱신**: `tests/extensions/pi-oven.test.ts:95` `model: anthropic/claude-opus-4-7` → `anthropic/claude-opus-4-8` (I7 stale; validateAgentRegistry test fixture).

- **DO NOT**: validateAgentRegistry 삭제 금지(AC#6 keep). captureSessionModel 삭제 금지(spec E 미명시 — open question).

### Task 3.2 — `lint-agents.ts` colon-name invariant + test (I3, AC#5)

- **File**: `scripts/lint-agents.ts`
- **File (test)**: `tests/scripts/lint-agents.test.ts` (갱신)

- **Anchor (현재)**:
  - `:62` `const role = file.replace(/^pi-oven-/, "").replace(/\.md$/, "")` — filename role 추출.
  - 추가: frontmatter `name` 필드 추출 + `name === "pi-oven:" + role` 불변식 검증(콜론 name = omp registry 키 = override 키, 불변식 필수, §4 I3).

- **추가 로직** (extractName helper):
  ```ts
  function extractName(frontmatter: Record<string, unknown>): string | undefined {
    const raw = frontmatter["name"];
    return typeof raw === "string" ? raw : undefined;
  }
  // in loop, after role guard:
  const name = extractName(frontmatter);
  const expectedName = `pi-oven:${role}`;
  if (name !== expectedName) {
    console.error(`lint-agents: ERROR: ${file} name="${name ?? "(missing)"}" must equal "${expectedName}" (colon registry key invariant).`);
    violations++;
  }
  ```

- **Edge cases**:
  - name 누락 → violation.
  - name 이 하이픈형(`pi-oven-critic`) → violation (콜론형이어야).
  - role ∉ ROLES (`continue` 이전) → name 검증 skip (현 가드 유지).

- **Test names + assertion shape** (`lint-agents.test.ts` 추가):
  - test: "agent with correct colon name passes" — write `pi-oven-critic.md` with `name: pi-oven:critic` + valid PROFILE_A model; assert exit 0.
  - test: "agent with hyphen name fails colon invariant" — `name: pi-oven-critic`; assert exit 1 + error contains "pi-oven:critic".
  - test: "agent with missing name fails" — no name field; assert exit 1.
  - test: "lint only inspects repo agents/, blind to user-global config.yml" — assert lint never reads ~/.omp/agent/config.yml (AC#5; meta — no config.yml access in script).
  - **주의**: 기존 lint test fixture (`pi-oven-coder.md` 등)는 `name` 필드 없음 → colon-name 검증 추가 시 기존 test red 가능. 기존 fixture 에 `name: pi-oven:<role>` 추가하거나, role ∉ ROLES (`coder` not in ROLES) 케이스는 name 검증 skip 되도록 가드 순서 확인. `pi-oven-coder`/`pi-oven-valid`/`pi-oven-bad` 는 ROLES 아님 → `continue` 로 skip → 기존 test 영향 없음(검증 필요).

- **DO NOT**: user-global config.yml 읽기 금지(lint = PROFILE_A baseline only, AC#5).

#### Wave 3 공유 계약 (codex PBc2-2)
Task 3.1(extension drift 제거)과 Task 2.2(apply maintainer-한정)/Task 2.4-2.5(rewrite 제거)는 agent-rewriter 의 "wizard 경로 제거 / maintainer 경로 한정" 계약을 공유. 이 계약이 Wave 2 에서 확정된 후에만 Task 3.1 의 `agent-rewriter` import 제거가 안전. agent-rewriter.ts 자체는 maintainer-generate(apply.ts:62-65)에서 여전히 호출되므로 **삭제 안 함** — wizard(override/reset/import) 경로에서만 분리. `tests/scripts/pi-oven-setup/agent-rewriter.test.ts` 는 maintainer 동작 검증으로 유지.

---

## Wave 4 — Docs / stale sweep (mechanical; executor haiku 가능, file-disjoint)

### Task 4.1 — `commands/pi-oven-setup.md` persistence 재작성 (I5)

- **File**: `commands/pi-oven-setup.md`
- **Anchor**: `:138` persist 설명, `:150` `--profile custom --override executor=anthropic/claude-opus-4-7`, `:155` plugin config 설명, `:194-208` Flag reference + Known limitations.
- **변경**:
  - `--profile custom` 행/예시 삭제(I2; A|B + 반복 `--override`).
  - `--reapply` 행 삭제(retire).
  - "plugin config write + agent file rewrite" → "config.yml task.agentModelOverrides write (machine-global, repo agents/ 무변경)".
  - "wizard MUST NOT touch agent files" 명시.
  - Known limitations 의 install-cache / plugin-upgrade-drift / --reapply / dev-mode-rewrite 항목 삭제(dead).
  - `anthropic/claude-opus-4-7` → `anthropic/claude-opus-4-8` (예시).
- **Acceptance**: `grep -n "reapply\|profile custom\|opus-4-7\|rewrite agent" commands/pi-oven-setup.md` → 0 (limitation 문구 포함).
- **DO NOT**: skills/ 변경 금지.

### Task 4.2 — opus-4-7 → 4-8 sweep (I7) — EXPLICIT per-line directives (Bc-3/Bc-8 resolved)

planner 가 5개 파일을 직접 읽고 줄별 판정 완료. executor 는 아래 directive 를 **그대로** 적용(판단 위임 없음). `change` = `opus-4-7`→`opus-4-8` (anthropic/ 와 opencode-zen/ 둘 다, 해당 줄 내 전부). `leave` = 변경 금지.

- **`README.md`**:
  - `:199` `- Reasoning-heavy (critic, security-reviewer, architect, ...): \`opencode-zen/claude-opus-4-7\`` — **change → `opencode-zen/claude-opus-4-8`**. (§"Profile A (release default)" 헤더 아래 = Profile A summary, stale.)
  - `:208` `- Reasoning-heavy: \`anthropic/claude-opus-4-7\`` — **leave** (§"Profile B (Anthropic opt-in)" 헤더 아래 = PROFILE_B, AC#7 deferred 예외).
- **`agents/pi-oven-critic.md`**:
  - `:69` `1. Stage 1: dispatch pi-oven:critic with \`--model opencode-zen/claude-opus-4-7\` (default primary).` — **change → `opencode-zen/claude-opus-4-8`**. 이는 body 예시 문구(frontmatter model 아님 — frontmatter 는 이미 4-8). lint(frontmatter SoT) 무영향. 의도된 stale-fix(spec §5 I7). agents/ 1줄 commit 은 spec §5 가 명시 허용.
- **`OPTIMIZED-MODEL.md`**: opus-4-7 잔존 **0** (이미 4-8, 13곳). → **이 파일 4.2 에서 no action**. (Task 4.5 의 project-memory sed 는 이미 적용 완료된 상태를 가정 — sed 제거만 하면 됨, 재적용 불요.)
- **`docs/specs/2026-05-28-pi-oven-setup-wizard.md`** (§4 Profile A = L125-163, §5 Profile B = L165-223, §6 = L224+):
  - `:57` `bun scripts/pi-oven-setup.ts --profile custom --override executor=anthropic/claude-opus-4-7` — **leave (historical Spec B, superseded by 옵션 C)**. 단일 directive: 변경 안 함. 근거: 2026-05-28 setup-wizard 는 옵션 C 가 supersede 하는 과거 spec 이고(I1 이 §2.1/§9.1 정정 명시), 이 줄은 이미 deprecated 된 `--profile custom`(I2) 예시이므로 model id 만 갱신하면 죽은 surface 를 손보는 noise. AC#7 historical 잔존 예외에 포함.
  - `:127` (§4 Profile A prose) `planner uses \`anthropic/claude-opus-4-7\` primary` — **leave** (historical Spec B prose, superseded; PROFILE_A 의 live SoT 는 profiles.ts + OPTIMIZED-MODEL.md, 둘 다 이미 4-8).
  - `:172,:184,:186,:189,:192,:197,:198,:199,:202,:203` — **leave** (전부 §5 Profile B, L165-223; PROFILE_B deferred 예외 + historical spec).
  - `:336,:338` — **leave** (§6 validation 예시; executor=sonnet-4-6 = Profile B map; historical + PROFILE_B).
  - → **setup-wizard.md 전체: no change** (전 줄 historical Spec B, 옵션 C supersede; live SoT 아님). Acceptance 의 잔존 예외에 포함.
- **`docs/specs/2026-05-28-pi-oven-agent-registry.md`** (Spec A — 옵션 C 의 ROLES/lint 의존 spec, 일부 live):
  - `:566` `확인됨 (claude-haiku-4-5, claude-opus-4-7, claude-sonnet-4-6 등). 2026-05-29 OPTIMIZED-MODEL revision 부터 Profile A 도 anthropic 사용` — **leave** (provider capability 의 과거 확인 기록 — "확인됨" 시점 사실. 모델 카탈로그 나열이지 PROFILE_A SoT 아님).
  - `:750` `alternate: \`opencode-zen/gpt-5.4\` (claude-opus-4-7이 registry에서 제거될 경우 ...)` — **leave** (조건절의 가정 모델명; resolution-time 전환 설명, 특정 role SoT 아님).
  - `:1226` `이미 §2 live verification 시 \`claude-opus-4-7 opencode-zen/claude-opus-4-8 2 1M 128K\`가 확인됨` — **leave** (과거 live-verification 기록 — 그 시점 `omp --list-models` 출력 인용. 역사 사실).
  - `:1228` `\`claude-opus-4-7\`이 deprecate되면 ... agents (critic, ...)가 실패` — **leave** (가정·리스크 설명, 모델 SoT 아님).
  - → **agent-registry.md 전체: no change** (전부 historical/conditional/capability-catalog, live SoT 아님).
- **Acceptance**: `grep -rIn "opus-4-7" . --exclude-dir=skills --exclude-dir=node_modules --exclude-dir=.git` 잔존 = 정확히 {profiles.ts:197-292 (PROFILE_B), README:208, harness-flow-progress.md:34, setup-wizard.md 전 줄, agent-registry.md:566/750/1226/1228, plans/2026-05-27-*, specs/2026-05-27-*, REVIEW-ME.md, pi-oven-doctor.md, user-queue.md historical} — AC#7 예외 집합. **이 cycle 의 실제 변경 = README:199 + agents/pi-oven-critic.md:69, 단 2곳**.
- **DO NOT**: profiles.ts PROFILE_B (`:197-292`) 변경 금지. README:208 변경 금지. setup-wizard.md / agent-registry.md 변경 금지(historical). skills/ 변경 금지.

### Task 4.3 — test fixture stale 정리 (I7 후속) — EXPLICIT

- **`tests/extensions/pi-oven.test.ts:95`** `"model: anthropic/claude-opus-4-7"` — **change → `anthropic/claude-opus-4-8`** (validateAgentRegistry fixture; whitelist-prefix test, 모델 id 는 임의 valid 면 됨 — 4-8 로 현행화). **단 Task 3.1 이 pi-oven.test.ts 를 이미 손대므로 Wave 3 Task 3.1 에서 함께 처리** (중복 회피 — 4.3 에서는 skip, Task 3.1 의 "갱신" 항목으로 이관됨).
  - → **Task 3.1 에 명시 이관**: Task 3.1 "갱신" 에 `:95 opus-4-7→4-8` 이미 기재됨. 4.3 에서 재처리 금지.
- **`tests/scripts/pi-oven-setup/reset.test.ts:136`** — 이 test("rewrites all 23 agent files back to Profile A") 는 **Task 2.4 에서 삭제**(dead rewrite 동작). → **N/A** (파일 자체가 reset.test.ts 전면 교체로 사라짐).
- **`tests/scripts/pi-oven-setup/auth-detect.test.ts:13,23`** — auth-detect.ts 가 **Task 2.6 에서 전체 삭제**되면 이 test 파일도 삭제 → **N/A**. (detectAuth 만 살리는 분기 시 :13/:23 → 4-8, 단 현 plan 은 전체 삭제 결정.)
- **결론**: Wave 4.3 는 **실질 작업 0** — 모든 fixture 가 Task 3.1(pi-oven.test.ts) / 2.4(reset.test) / 2.6(auth-detect.test) 에서 흡수됨. 이 task 는 "잔존 opus-4-7 fixture 0 확인" 검증 게이트로만 존재.
- **Acceptance**: `grep -rn "opus-4-7" tests/` → 0 (모든 fixture 가 4-8 또는 삭제). `bun test` green.

### Task 4.4 — `models.yml` 삭제 + 참조 정리 (I6, Q-MODELS-YML=DELETE)

- **Files**:
  - `models.yml` → **삭제** (0 readers 확인됨: 코드 grep 0, docs 참조만).
  - `docs/instincts/omp-install-layout.md:43` 의 plugin 자원 목록에서 `models.yml` 제거.
  - 과거 plan/spec 문서(`docs/plans/2026-05-27-*`, `docs/specs/2026-05-27-*`)의 models.yml 언급은 **역사적 기록이므로 보존**(Wave 4 scope 는 live 참조만).
- **Acceptance**: `ls models.yml` → 부재; `grep -rn "models.yml" scripts/ .omp/ commands/ .claude-plugin/` → 0.
- **DO NOT**: 과거 plan/spec 의 역사 기록 수정 금지.

### Task 4.5 — `project-memory.json` sed 제거 (I8) + WORKING-CONTEXT 정정 (I1)

- **Files + anchor**:
  - `.omc/project-memory.json:29-30` `buildCommand`/`testCommand` 의 destructive sed → **plain pipeline 복원**. OPTIMIZED-MODEL.md 는 이미 4-8 (opus-4-7 잔존 0 확인) → sed 재적용 불요, **sed 제거만**. 복원 후 build = `bun run check && bun run build`, test = `bun test` 등 plain (4-8 자체는 OPTIMIZED-MODEL.md 에 이미 반영됨).
  - `docs/WORKING-CONTEXT.md:33` "Spec E (옵션 B) draft" → "옵션 C 채택 (FROZEN v3); 옵션 B phantom path 폐기" 정정(I1).
- **Acceptance**: `grep -n "sed -i" .omc/project-memory.json` → 0; WORKING-CONTEXT:33 이 옵션 C 반영.
- **DO NOT**: project-memory 의 다른 필드 변경 금지.

#### Split rationale (Wave 4)
5 task: 4.1(command doc), 4.2(opus sweep prod+spec), 4.3(test fixture), 4.4(models.yml), 4.5(project-memory+WORKING-CONTEXT)는 file-disjoint. 4.3 은 Wave 3 와 중복 가능(조율). 4.2 의 A/B 판별 + agent body 1줄은 신중 필요 → sonnet, 나머지는 haiku 가능.

---

## Acceptance Criteria (spec §6 재진술 — verifier 사용)

- **AC#1 (standalone override + baseline 무변경, Bc-7 scoped)**: `--override critic=anthropic/claude-opus-4-8` 단독 실행(주입 spawnFn: get→`{}`, set capture) → 캡처된 `omp config set task.agentModelOverrides` 의 json 이 `["pi-oven:critic"] === "anthropic/claude-opus-4-8"` AND exitCode 0 AND stdout !~ /No action/. **tracked baseline 무변경**: `git status --short -- agents/ scripts/` 가 빈 출력(whole-tree clean 은 단언 안 함 — workspace 에 무관 untracked 파일 존재 가능; 추적 대상 agents/scripts 만 검사). **plugin-lock 무변경**: mock spawnFn 이 `omp plugin config ...` 로 호출된 적 없음을 단언(또는 live 시 `~/.omp/plugins/omp-plugins.lock.json` before/after sha256 동일). override 는 omp config(task.agentModelOverrides) 로만 landing — repo 밖. **Unit/integration** (transport spawn capture + dispatcher route). live 불요.
- **AC#2 (MERGE)**: 두 role 연속 override → 최종 set-json 에 두 colon key 공존(`mergeOverrideRecord` 가 형제 보존). `--reset` → set-json 에서 `pi-oven:*` 만 제거, 비-pi-oven 키 보존. **Unit** (config-yml.test.ts mergeOverrideRecord + setAgentModelOverride spawn capture + reset.test.ts).
- **AC#3 (effective model)**:
  - (a) DISCOVERY/runtime: `discoverAgents(cwd)` 가 `pi-oven:critic` 반환 + dispatch 시 resolved model = override 값. **LIVE-smoke caveat**: 설치 cache `agents/` 가 비어있음(audit A7, deferred) → live agent dispatch 불가. **이 check 는 "requires agents on main / local cache populated" 로 표시**, CI 게이트에서 제외. plan 의 unit/integration 은 live dispatch 비의존: config-read assertion(AC#1) + dispatcher routing unit(2.1) + validator unit(1.2) + status-calc unit(2.3) 로 대체. runtime observability 검증 방법은 `executor.ts:1157 progress.resolvedModel` 캡처로 **1개 고정**(실행은 cache populated 시).
  - (b) NEGATIVE: retired id (`anthropic/claude-opus-4-7`) override → setup-time 거부(exit 1, no write). **Unit** (model-id-validator.test.ts + override 거부 test). 거부 우회 시 dispatch 는 default fallback(hard-fail 아님) — 문서화.
- **AC#4 (configured effective override)**: `--status` 가 role 별 `override(pi-oven:<role>) ?? frontmatter[0]` + source(override/default) 표시, 미해소 경고. configured precedence(runtime 해소 아님). override 는 omp config get(readAgentModelOverrides)로 읽음. **Unit** (status.test.ts, fixture frontmatter + 주입 spawnFn get record).
- **AC#5 (lint scope)**: lint-agents 는 repo agents/ 만 검사 + frontmatter name === `pi-oven:`+role 불변식 통과. **Unit** (lint-agents.test.ts).
- **AC#6 (dead-path 제거)**: `grep` 검증 — `--reapply`/`--profile custom`(CLI 값)/`confirm-auth` dispatcher·doc 부재; persist.ts model-data write/read 부재(파일 삭제); extension session_start drift block 부재; apply/reset/import 가 rewriteAllAgents 미호출(wizard 경로). **Grep meta-test + tsc clean**.
- **AC#7 (stale sweep)**: 이 cycle 의 실제 변경 = **README:199 + agents/pi-oven-critic.md:69 단 2곳** (Task 4.2 explicit directive). `grep -rIn "opus-4-7" . --exclude-dir=skills --exclude-dir=node_modules --exclude-dir=.git` 잔존 = {profiles.ts:197-292(PROFILE_B), README:208, harness-flow-progress.md:34, setup-wizard.md 전 줄, agent-registry.md:566/750/1226/1228, plans/2026-05-27-*, specs/2026-05-27-*, REVIEW-ME.md, pi-oven-doctor.md, user-queue.md} = AC#7 deferred/historical 예외 집합과 정확히 일치(Task 4.2 Acceptance). models.yml 부재 + live 참조 0. project-memory sed 제거. **Grep meta-test**.

전체 게이트: `bun test` green, `bun run check` (tsc) clean, `bun run lint:agents` exit 0, `bun run lint:skills` exit 0, `bun run build` clean. 최종 fresh-agent verifier(opus).

---

## Out of scope (spec §7/§8 — 계획 안 함)

- A7 distribution/origin-main merge, version SoT bump (package.json 0.1.0 vs manifest 0.1.0) — **DEFER**.
- PROFILE_B (profiles.ts:197-292) opus-4-7→4-8 bump — **DEFER** (AC#7 예외).
- per-project committed override — 개인·머신로컬 시나리오 확정, 불필요.
- omp upstream 변경 — 옵션 C 는 omp 무수정 동작.

---

## Open Questions

- `pi-oven-session-model.json` (captureSessionModel, pi-oven.ts:286/300) 가 dead 인지: parent-session capture 호출처가 Spec B §6 auth-fallback 진단 외에 살아있는지 grep 미확정. spec E 가 명시 제거 안 했으므로 이 plan 은 **보수적 유지**. dead 확정 시 후속 cleanup(이 plan scope 밖).

(이전 OQ#2 agent-registry.md 줄별 판정 / OQ#3 setup-wizard.md Profile A/B 판별 → Task 4.2 의 EXPLICIT per-line directive 로 해소됨. planner 가 5개 파일 직접 read 후 줄별 change/leave 확정.)
