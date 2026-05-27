# pi-oven Plan 1 — Installer Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bash installer가 Phase 0–2 (preflight → omp install/upgrade → pi-oven 스킬 시드 + CLAUDE.md routing block) 까지 동작하는 v0.1.0 마일스톤을 만든다. Adapter / CRG / providers 는 Plan 2–3 에서.

**Architecture:** 단일 `install.sh` 가 `install/lib/*.sh` phase scripts 를 순차 dispatch. State 는 `~/.cache/pi-oven/installer.json` 에 기록 (resume 지원). pi-oven 본체는 `github.com/kimzerokim/pi-oven` 에서 매번 fresh fetch.

**Tech Stack:** bash (POSIX-leaning, 단 `set -euo pipefail`), bats-core for tests, `jq` for JSON state, `git` for upstream fetch, `sed`/`awk` for marker block manipulation.

**Spec reference:** `docs/superpowers/specs/2026-05-26-pi-oven-design.md` §5 (Install Flow), §10 (CLAUDE.md), §9 (Repo Layout).

---

## File Structure

| File | Responsibility |
|---|---|
| `README.md` | curl one-liner + 핵심 컨셉 |
| `LICENSE` | MIT |
| `.gitignore` | node_modules, .DS_Store, tmp |
| `CHANGELOG.md` | v0.1.0 onward |
| `CLAUDE.md` | distribution SoT + dogfood (§10) |
| `install.sh` | curl entrypoint, arg parse, phase dispatch |
| `install/lib/log.sh` | info / warn / error / die helpers |
| `install/lib/state.sh` | installer.json read/write/get/set |
| `install/lib/preflight.sh` | Phase 0 |
| `install/lib/install-omp.sh` | Phase 1 |
| `install/lib/seed-skills.sh` | Phase 2 (version-aware sync + drift cleanup) |
| `install/lib/render-routing-block.sh` | marker block generator |
| `install/templates/routing-block.md` | marker block 기본 텍스트 |
| `install/lib/min-versions.json` | omp/pi-oven minimum 버전 floor |
| `tests/lib/_setup.bash` | bats common setup (tmpdir, fake $HOME) |
| `tests/preflight.bats` | Phase 0 시나리오 |
| `tests/install-omp.bats` | Phase 1 시나리오 (omp 인스톨러 모킹) |
| `tests/seed-skills.bats` | Phase 2 시나리오 (fake pi-oven fixture) |
| `tests/routing-block.bats` | marker block 생성 + merge 시나리오 |
| `tests/install-flow.bats` | end-to-end Phase 0-2 smoke |

---

## Task 1: Repo scaffold (README, LICENSE, .gitignore, CHANGELOG)

**Files:**
- Create: `README.md`
- Create: `LICENSE`
- Create: `.gitignore`
- Create: `CHANGELOG.md`

- [ ] **Step 1: Write README.md**

```markdown
# pi-oven

oh-my-pi runtime + pi-oven workflow, in one install.

## Install

권장 방식 — Claude Code / Codex / omp 안에서 `docs/install/prompt-claude-code.md`
의 prompt 를 복붙. AI 가 mode 결정 / provider 입력을 인터랙티브 처리.

자동화 환경 (CI/Docker) 용:

```bash
curl -fsSL https://raw.githubusercontent.com/kimzerokim/pi-oven/main/install.sh \
  | sh -s -- --global
```

## Status

v0.1.0 — Phase 0-2 (preflight, omp install/upgrade, pi-oven 시드) 만 동작.
Phase 3+ (adapter, CRG, providers) 는 Plan 2-3 에서.

See `docs/superpowers/specs/2026-05-26-pi-oven-design.md` for full design.
```

- [ ] **Step 2: Write LICENSE (MIT)**

```
MIT License

Copyright (c) 2026 kimzerokim

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 3: Write .gitignore**

```
.DS_Store
node_modules/
*.log
/tmp/
/.omc/
/.cache/
.code-review-graph/
packages/*/dist/
packages/*/node_modules/
```

- [ ] **Step 4: Write CHANGELOG.md**

```markdown
# Changelog

## [Unreleased]

### Plan 1 — Installer Foundation
- Repo scaffold (README, LICENSE, .gitignore, CHANGELOG)
- install.sh entry + Phase 0 (preflight) + Phase 1 (omp) + Phase 2 (pi-oven seed)
- CLAUDE.md routing block generator
```

- [ ] **Step 5: Commit**

```bash
git add README.md LICENSE .gitignore CHANGELOG.md
git commit -m "chore: repo scaffold (README, LICENSE, gitignore, CHANGELOG)"
```

---

## Task 2: install.sh entry + log/state helpers

**Files:**
- Create: `install/lib/log.sh`
- Create: `install/lib/state.sh`
- Create: `install.sh`
- Create: `tests/lib/_setup.bash`
- Create: `tests/install-flow.bats`

- [ ] **Step 1: Write failing bats test for arg parsing**

Create `tests/lib/_setup.bash`:

```bash
# Common bats setup. Source via `load 'lib/_setup'` in each test file.
setup_install_tmpdir() {
  export PI_OVEN_PI_TEST_HOME="$(mktemp -d)"
  export HOME="$PI_OVEN_PI_TEST_HOME"
  export XDG_CACHE_HOME="$PI_OVEN_PI_TEST_HOME/.cache"
  export XDG_CONFIG_HOME="$PI_OVEN_PI_TEST_HOME/.config"
  mkdir -p "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME"
}

teardown_install_tmpdir() {
  rm -rf "$PI_OVEN_PI_TEST_HOME"
}

REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
```

Create `tests/install-flow.bats`:

```bash
#!/usr/bin/env bats
load 'lib/_setup'

setup() { setup_install_tmpdir; }
teardown() { teardown_install_tmpdir; }

@test "install.sh prints usage when no mode flag given" {
  run bash "$REPO_ROOT/install.sh"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "--global" ]]
  [[ "$output" =~ "--project" ]]
}

@test "install.sh --help prints usage and exits 0" {
  run bash "$REPO_ROOT/install.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "install.sh --global writes installer state file" {
  run bash "$REPO_ROOT/install.sh" --global --skip-phases 1,2
  [ "$status" -eq 0 ]
  [ -f "$XDG_CACHE_HOME/pi-oven/installer.json" ]
}
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
bats tests/install-flow.bats
```
Expected: 3 failures, all reporting "install.sh not found" or similar.

- [ ] **Step 3: Write `install/lib/log.sh`**

```bash
#!/usr/bin/env bash
# Logging helpers. Source from other phase scripts.

_pi-oven_pi_color() {
  case "${TERM:-}" in
    dumb|"") echo "$2" ;;
    *) printf '\033[%sm%s\033[0m' "$1" "$2" ;;
  esac
}

pi-oven_pi_info()  { echo "$(_pi-oven_pi_color '0;36' '[pi-oven]') $*" >&2; }
pi-oven_pi_warn()  { echo "$(_pi-oven_pi_color '0;33' '[pi-oven WARN]') $*" >&2; }
pi-oven_pi_error() { echo "$(_pi-oven_pi_color '0;31' '[pi-oven ERROR]') $*" >&2; }
pi-oven_pi_die()   { pi-oven_pi_error "$*"; exit 1; }
```

- [ ] **Step 4: Write `install/lib/state.sh`**

```bash
#!/usr/bin/env bash
# Installer state file helpers. Requires jq.

PI_OVEN_PI_STATE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/pi-oven"
PI_OVEN_PI_STATE_FILE="$PI_OVEN_PI_STATE_DIR/installer.json"

pi-oven_pi_state_init() {
  mkdir -p "$PI_OVEN_PI_STATE_DIR"
  if [ ! -f "$PI_OVEN_PI_STATE_FILE" ]; then
    echo '{"phases":{},"version":"0.1.0","startedAt":""}' > "$PI_OVEN_PI_STATE_FILE"
  fi
}

pi-oven_pi_state_set() {
  local key="$1" val="$2"
  pi-oven_pi_state_init
  local tmp
  tmp="$(mktemp)"
  jq --arg k "$key" --arg v "$val" '.[$k] = $v' "$PI_OVEN_PI_STATE_FILE" > "$tmp"
  mv "$tmp" "$PI_OVEN_PI_STATE_FILE"
}

pi-oven_pi_state_mark_phase() {
  local phase="$1" status="$2"
  pi-oven_pi_state_init
  local tmp
  tmp="$(mktemp)"
  jq --arg p "$phase" --arg s "$status" \
    '.phases[$p] = {status: $s, ts: now | todate}' \
    "$PI_OVEN_PI_STATE_FILE" > "$tmp"
  mv "$tmp" "$PI_OVEN_PI_STATE_FILE"
}

pi-oven_pi_state_get_phase() {
  local phase="$1"
  pi-oven_pi_state_init
  jq -r --arg p "$phase" '.phases[$p].status // "pending"' "$PI_OVEN_PI_STATE_FILE"
}
```

- [ ] **Step 5: Write `install.sh` (entry)**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=install/lib/log.sh
. "$SCRIPT_DIR/install/lib/log.sh"
# shellcheck source=install/lib/state.sh
. "$SCRIPT_DIR/install/lib/state.sh"

PI_OVEN_PI_MODE=""
PI_OVEN_PI_RESUME=0
PI_OVEN_PI_DRY_RUN=0
PI_OVEN_PI_SKIP_PHASES=""

usage() {
  cat <<'USAGE'
Usage: install.sh (--global | --project) [--resume] [--dry-run] [--skip-phases N,N,...]

Modes:
  --global    Install pi-oven globally (~/.config/omp/, recommended)
  --project   Install into current directory (must be project root)

Options:
  --resume                Resume from last successful phase
  --dry-run               Show what would change without writing
  --skip-phases LIST      Skip listed phase numbers (test-only)
  --help                  Show this message
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --global)  PI_OVEN_PI_MODE="global" ;;
    --project) PI_OVEN_PI_MODE="project" ;;
    --resume)  PI_OVEN_PI_RESUME=1 ;;
    --dry-run) PI_OVEN_PI_DRY_RUN=1 ;;
    --skip-phases) PI_OVEN_PI_SKIP_PHASES="$2"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) pi-oven_pi_error "Unknown arg: $1"; usage >&2; exit 2 ;;
  esac
  shift
done

if [ -z "$PI_OVEN_PI_MODE" ]; then
  usage >&2
  exit 2
fi

pi-oven_pi_state_init
pi-oven_pi_state_set "mode" "$PI_OVEN_PI_MODE"
pi-oven_pi_state_set "startedAt" "$(date -u +%FT%TZ)"

pi-oven_pi_info "Mode: $PI_OVEN_PI_MODE"

run_phase() {
  local n="$1" script="$2"
  if [[ ",$PI_OVEN_PI_SKIP_PHASES," == *",$n,"* ]]; then
    pi-oven_pi_info "Phase $n: SKIPPED (--skip-phases)"
    return 0
  fi
  if [ "$PI_OVEN_PI_RESUME" = "1" ] && [ "$(pi-oven_pi_state_get_phase "$n")" = "completed" ]; then
    pi-oven_pi_info "Phase $n: already completed (resume)"
    return 0
  fi
  pi-oven_pi_info "Phase $n: starting"
  if ! . "$SCRIPT_DIR/install/lib/$script"; then
    pi-oven_pi_state_mark_phase "$n" "failed"
    pi-oven_pi_die "Phase $n failed. Re-run with --resume to continue."
  fi
  pi-oven_pi_state_mark_phase "$n" "completed"
  pi-oven_pi_info "Phase $n: done"
}

# Phase dispatch (Plan 1 covers 0-2; later plans add 3-6)
run_phase 0 preflight.sh
run_phase 1 install-omp.sh
run_phase 2 seed-skills.sh

pi-oven_pi_info "Plan 1 milestone complete (Phases 0-2). Phases 3-6 ship in Plan 2-3."
```

- [ ] **Step 6: Make install.sh + phase scripts executable, create empty phase stubs so dispatch doesn't error**

```bash
chmod +x install.sh
touch install/lib/preflight.sh install/lib/install-omp.sh install/lib/seed-skills.sh
chmod +x install/lib/*.sh
```

Initial contents of each stub: just `pi-oven_pi_info "Phase stub — not yet implemented"; return 0`.

- [ ] **Step 7: Run tests to verify pass**

```bash
bats tests/install-flow.bats
```
Expected: all 3 pass.

- [ ] **Step 8: Commit**

```bash
git add install.sh install/lib/log.sh install/lib/state.sh install/lib/preflight.sh \
  install/lib/install-omp.sh install/lib/seed-skills.sh tests/lib/_setup.bash tests/install-flow.bats
git commit -m "feat(installer): install.sh entry + log/state helpers + bats setup"
```

---

## Task 3: Phase 0 — Preflight

**Files:**
- Modify: `install/lib/preflight.sh`
- Create: `tests/preflight.bats`

- [ ] **Step 1: Write failing tests**

Create `tests/preflight.bats`:

```bash
#!/usr/bin/env bats
load 'lib/_setup'

setup() { setup_install_tmpdir; }
teardown() { teardown_install_tmpdir; }

@test "preflight: --global passes on darwin arm64" {
  PI_OVEN_PI_MODE=global \
    PI_OVEN_PI_FAKE_UNAME="Darwin arm64" \
    run bash -c ". $REPO_ROOT/install/lib/log.sh; . $REPO_ROOT/install/lib/state.sh; . $REPO_ROOT/install/lib/preflight.sh"
  [ "$status" -eq 0 ]
}

@test "preflight: --global passes on linux x86_64" {
  PI_OVEN_PI_MODE=global PI_OVEN_PI_FAKE_UNAME="Linux x86_64" \
    run bash -c ". $REPO_ROOT/install/lib/log.sh; . $REPO_ROOT/install/lib/state.sh; . $REPO_ROOT/install/lib/preflight.sh"
  [ "$status" -eq 0 ]
}

@test "preflight: unsupported OS aborts" {
  PI_OVEN_PI_MODE=global PI_OVEN_PI_FAKE_UNAME="OpenBSD amd64" \
    run bash -c ". $REPO_ROOT/install/lib/log.sh; . $REPO_ROOT/install/lib/state.sh; . $REPO_ROOT/install/lib/preflight.sh"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Unsupported" ]]
}

@test "preflight: --project mode in non-project dir aborts" {
  PI_OVEN_PI_MODE=project PI_OVEN_PI_FAKE_UNAME="Darwin arm64" \
    run bash -c "cd $PI_OVEN_PI_TEST_HOME; . $REPO_ROOT/install/lib/log.sh; . $REPO_ROOT/install/lib/state.sh; . $REPO_ROOT/install/lib/preflight.sh"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "project root" ]]
}

@test "preflight: --project mode in git repo passes" {
  cd "$PI_OVEN_PI_TEST_HOME"
  git init -q
  PI_OVEN_PI_MODE=project PI_OVEN_PI_FAKE_UNAME="Darwin arm64" \
    run bash -c "cd $PI_OVEN_PI_TEST_HOME; . $REPO_ROOT/install/lib/log.sh; . $REPO_ROOT/install/lib/state.sh; . $REPO_ROOT/install/lib/preflight.sh"
  [ "$status" -eq 0 ]
}
```

- [ ] **Step 2: Run to confirm failure**

```bash
bats tests/preflight.bats
```
Expected: 5 failures.

- [ ] **Step 3: Implement `install/lib/preflight.sh`**

```bash
#!/usr/bin/env bash
# Phase 0 — Preflight. Sourced by install.sh.

_uname_pair() {
  if [ -n "${PI_OVEN_PI_FAKE_UNAME:-}" ]; then
    echo "$PI_OVEN_PI_FAKE_UNAME"
  else
    echo "$(uname -s) $(uname -m)"
  fi
}

_is_project_root() {
  [ -d ".git" ] || [ -f "CLAUDE.md" ] || [ -f "AGENTS.md" ]
}

# OS/arch check
pair="$(_uname_pair)"
case "$pair" in
  "Darwin arm64"|"Darwin x86_64"|"Linux x86_64"|"Linux aarch64"|"Linux arm64")
    pi-oven_pi_info "Preflight: OS=$pair OK"
    ;;
  *)
    pi-oven_pi_die "Unsupported OS/arch: $pair. v1 supports darwin/linux × arm64/x64."
    ;;
esac

# Project mode validation
if [ "$PI_OVEN_PI_MODE" = "project" ]; then
  if ! _is_project_root; then
    pi-oven_pi_die "Preflight: --project mode requires cwd to be a project root (git repo OR CLAUDE.md/AGENTS.md present)."
  fi
  pi-oven_pi_info "Preflight: project root verified at $(pwd)"
fi

# bun/node detection (we need one)
if command -v bun >/dev/null 2>&1; then
  pi-oven_pi_info "Preflight: bun $(bun --version) detected"
elif command -v node >/dev/null 2>&1; then
  node_major="$(node --version | sed 's/^v\([0-9]*\).*/\1/')"
  if [ "$node_major" -ge 20 ]; then
    pi-oven_pi_info "Preflight: node $(node --version) detected"
  else
    pi-oven_pi_die "Preflight: node $node_major < 20. Install node 20+ or bun."
  fi
else
  pi-oven_pi_die "Preflight: neither bun nor node 20+ found. Install bun via: curl -fsSL https://bun.sh/install | bash"
fi

# jq required for state file
command -v jq >/dev/null 2>&1 \
  || pi-oven_pi_die "Preflight: jq not found. Install via: brew install jq (macOS) / apt install jq (debian)."

# git required for Phase 2
command -v git >/dev/null 2>&1 \
  || pi-oven_pi_die "Preflight: git not found."
```

- [ ] **Step 4: Run tests to verify pass**

```bash
bats tests/preflight.bats
```
Expected: all 5 pass.

- [ ] **Step 5: Commit**

```bash
git add install/lib/preflight.sh tests/preflight.bats
git commit -m "feat(installer): Phase 0 preflight (OS/arch, mode, bun/node/jq/git checks)"
```

---

## Task 4: Phase 1 — omp install/upgrade

**Files:**
- Modify: `install/lib/install-omp.sh`
- Create: `install/lib/min-versions.json`
- Create: `tests/install-omp.bats`

- [ ] **Step 1: Write min-versions.json**

```json
{
  "omp": "0.1.0",
  "pi-oven": "1.0.0"
}
```

(Floor will be raised at v1 release once we've tested against a concrete omp version.)

- [ ] **Step 2: Write failing tests**

Create `tests/install-omp.bats`:

```bash
#!/usr/bin/env bats
load 'lib/_setup'

setup() { setup_install_tmpdir; }
teardown() { teardown_install_tmpdir; }

@test "install-omp: detected omp above min → no-op" {
  fake_bin="$PI_OVEN_PI_TEST_HOME/bin"
  mkdir -p "$fake_bin"
  cat > "$fake_bin/omp" <<'SH'
#!/bin/sh
[ "$1" = "--version" ] && echo "1.2.3"
SH
  chmod +x "$fake_bin/omp"
  PATH="$fake_bin:$PATH" \
    PI_OVEN_PI_REPO_ROOT="$REPO_ROOT" \
    run bash -c ". $REPO_ROOT/install/lib/log.sh; . $REPO_ROOT/install/lib/state.sh; . $REPO_ROOT/install/lib/install-omp.sh"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "omp 1.2.3 detected" ]]
  [[ "$output" =~ "above minimum" ]]
}

@test "install-omp: missing omp → install attempted" {
  PATH="$PI_OVEN_PI_TEST_HOME/empty-bin:$PATH" \
    PI_OVEN_PI_REPO_ROOT="$REPO_ROOT" \
    PI_OVEN_PI_OMP_INSTALL_CMD="echo MOCK_INSTALL_RAN" \
    run bash -c ". $REPO_ROOT/install/lib/log.sh; . $REPO_ROOT/install/lib/state.sh; . $REPO_ROOT/install/lib/install-omp.sh"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "MOCK_INSTALL_RAN" ]]
}

@test "install-omp: detected omp below min → upgrade attempted" {
  fake_bin="$PI_OVEN_PI_TEST_HOME/bin"
  mkdir -p "$fake_bin"
  cat > "$fake_bin/omp" <<'SH'
#!/bin/sh
[ "$1" = "--version" ] && echo "0.1.0"
SH
  chmod +x "$fake_bin/omp"
  PATH="$fake_bin:$PATH" \
    PI_OVEN_PI_REPO_ROOT="$REPO_ROOT" \
    PI_OVEN_PI_OMP_INSTALL_CMD="echo MOCK_UPGRADE_RAN" \
    PI_OVEN_PI_ASSUME_YES=1 \
    run bash -c ". $REPO_ROOT/install/lib/log.sh; . $REPO_ROOT/install/lib/state.sh; . $REPO_ROOT/install/lib/install-omp.sh"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "below minimum" ]]
  [[ "$output" =~ "MOCK_UPGRADE_RAN" ]]
}
```

- [ ] **Step 3: Run to confirm failure**

```bash
bats tests/install-omp.bats
```
Expected: 3 failures.

- [ ] **Step 4: Implement `install/lib/install-omp.sh`**

```bash
#!/usr/bin/env bash
# Phase 1 — omp install/upgrade. Sourced by install.sh.

PI_OVEN_PI_REPO_ROOT="${PI_OVEN_PI_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
PI_OVEN_PI_OMP_INSTALL_CMD="${PI_OVEN_PI_OMP_INSTALL_CMD:-curl -fsSL https://omp.sh/install | sh}"

_semver_ge() {
  # _semver_ge a b → true if a >= b
  printf '%s\n%s\n' "$1" "$2" | sort -V -C
}

_omp_min() {
  jq -r '.omp' "$PI_OVEN_PI_REPO_ROOT/install/lib/min-versions.json"
}

min="$(_omp_min)"

if command -v omp >/dev/null 2>&1; then
  current="$(omp --version 2>/dev/null | head -n1 | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)"
  if [ -z "$current" ]; then
    pi-oven_pi_die "Phase 1: omp present but --version not parseable. Check omp install."
  fi
  if _semver_ge "$current" "$min"; then
    pi-oven_pi_info "Phase 1: omp $current detected, above minimum ($min). No-op."
  else
    pi-oven_pi_warn "Phase 1: omp $current below minimum ($min). Will upgrade."
    if [ "${PI_OVEN_PI_ASSUME_YES:-0}" != "1" ]; then
      read -r -p "[pi-oven] Upgrade omp now? [y/N] " ans
      case "$ans" in y|Y|yes) ;; *) pi-oven_pi_die "User declined omp upgrade." ;; esac
    fi
    eval "$PI_OVEN_PI_OMP_INSTALL_CMD" || pi-oven_pi_die "Phase 1: omp upgrade command failed."
  fi
else
  pi-oven_pi_info "Phase 1: omp not found. Installing..."
  eval "$PI_OVEN_PI_OMP_INSTALL_CMD" || pi-oven_pi_die "Phase 1: omp install command failed."
fi
```

- [ ] **Step 5: Run tests to verify pass**

```bash
bats tests/install-omp.bats
```
Expected: all 3 pass.

- [ ] **Step 6: Commit**

```bash
git add install/lib/install-omp.sh install/lib/min-versions.json tests/install-omp.bats
git commit -m "feat(installer): Phase 1 omp install/upgrade with semver gate"
```

---

## Task 5: Phase 2 — pi-oven seed (clone + version-aware sync)

**Files:**
- Modify: `install/lib/seed-skills.sh`
- Create: `tests/seed-skills.bats`
- Create: `tests/fixtures/fake-pi-oven/skills/pi-oven-foo/SKILL.md`
- Create: `tests/fixtures/fake-pi-oven/skills/pi-oven-bar/SKILL.md`
- Create: `tests/fixtures/fake-pi-oven/harness-share.md`

- [ ] **Step 1: Build fixture — a fake pi-oven checkout**

Create `tests/fixtures/fake-pi-oven/skills/pi-oven-foo/SKILL.md`:

```markdown
---
name: pi-oven-foo
description: Required triggers — `foo trigger`, `bar trigger`
version: 1.2.0
---

Foo skill body.
```

Create `tests/fixtures/fake-pi-oven/skills/pi-oven-bar/SKILL.md`:

```markdown
---
name: pi-oven-bar
description: Required triggers — `bar test`
version: 0.1.0
---

Bar skill body.
```

Create `tests/fixtures/fake-pi-oven/harness-share.md`:

```markdown
# Harness Share (fixture)

Fixture content for seed-skills tests.
```

- [ ] **Step 2: Write failing tests**

Create `tests/seed-skills.bats`:

```bash
#!/usr/bin/env bats
load 'lib/_setup'

setup() {
  setup_install_tmpdir
  export PI_OVEN_PI_FAKE_HARNESS_SRC="$REPO_ROOT/tests/fixtures/fake-pi-oven"
}
teardown() { teardown_install_tmpdir; }

@test "seed-skills: fresh global install copies all SKILL.md + harness-share.md" {
  PI_OVEN_PI_MODE=global \
    run bash -c ". $REPO_ROOT/install/lib/log.sh; . $REPO_ROOT/install/lib/state.sh; . $REPO_ROOT/install/lib/seed-skills.sh"
  [ "$status" -eq 0 ]
  [ -f "$XDG_CONFIG_HOME/omp/skills/pi-oven-foo/SKILL.md" ]
  [ -f "$XDG_CONFIG_HOME/omp/skills/pi-oven-bar/SKILL.md" ]
  [ -f "$XDG_CONFIG_HOME/omp/.pi-oven-shared/harness-share.md" ]
}

@test "seed-skills: source newer version overwrites local" {
  PI_OVEN_PI_MODE=global \
    bash -c ". $REPO_ROOT/install/lib/log.sh; . $REPO_ROOT/install/lib/state.sh; . $REPO_ROOT/install/lib/seed-skills.sh"
  # Tamper local copy with older version
  sed -i.bak 's/version: 1.2.0/version: 1.0.0/' "$XDG_CONFIG_HOME/omp/skills/pi-oven-foo/SKILL.md"
  PI_OVEN_PI_MODE=global \
    run bash -c ". $REPO_ROOT/install/lib/log.sh; . $REPO_ROOT/install/lib/state.sh; . $REPO_ROOT/install/lib/seed-skills.sh"
  [ "$status" -eq 0 ]
  grep -q "version: 1.2.0" "$XDG_CONFIG_HOME/omp/skills/pi-oven-foo/SKILL.md"
}

@test "seed-skills: local newer version preserved with log" {
  PI_OVEN_PI_MODE=global \
    bash -c ". $REPO_ROOT/install/lib/log.sh; . $REPO_ROOT/install/lib/state.sh; . $REPO_ROOT/install/lib/seed-skills.sh"
  # Tamper local copy with newer version
  sed -i.bak 's/version: 1.2.0/version: 9.9.9/' "$XDG_CONFIG_HOME/omp/skills/pi-oven-foo/SKILL.md"
  PI_OVEN_PI_MODE=global \
    run bash -c ". $REPO_ROOT/install/lib/log.sh; . $REPO_ROOT/install/lib/state.sh; . $REPO_ROOT/install/lib/seed-skills.sh"
  [ "$status" -eq 0 ]
  grep -q "version: 9.9.9" "$XDG_CONFIG_HOME/omp/skills/pi-oven-foo/SKILL.md"
  [[ "$output" =~ "skipped pi-oven-foo" ]]
}

@test "seed-skills: drift cleanup (local-only skill) prompts and removes on yes" {
  PI_OVEN_PI_MODE=global \
    bash -c ". $REPO_ROOT/install/lib/log.sh; . $REPO_ROOT/install/lib/state.sh; . $REPO_ROOT/install/lib/seed-skills.sh"
  mkdir -p "$XDG_CONFIG_HOME/omp/skills/pi-oven-orphan"
  echo "---\nname: pi-oven-orphan\nversion: 0.1.0\n---" > "$XDG_CONFIG_HOME/omp/skills/pi-oven-orphan/SKILL.md"
  PI_OVEN_PI_MODE=global PI_OVEN_PI_ASSUME_YES=1 \
    run bash -c ". $REPO_ROOT/install/lib/log.sh; . $REPO_ROOT/install/lib/state.sh; . $REPO_ROOT/install/lib/seed-skills.sh"
  [ "$status" -eq 0 ]
  [ ! -d "$XDG_CONFIG_HOME/omp/skills/pi-oven-orphan" ]
}

@test "seed-skills: project mode writes to <proj>/.omp/" {
  cd "$PI_OVEN_PI_TEST_HOME"
  git init -q
  PI_OVEN_PI_MODE=project \
    run bash -c "cd $PI_OVEN_PI_TEST_HOME; . $REPO_ROOT/install/lib/log.sh; . $REPO_ROOT/install/lib/state.sh; . $REPO_ROOT/install/lib/seed-skills.sh"
  [ "$status" -eq 0 ]
  [ -f "$PI_OVEN_PI_TEST_HOME/.omp/skills/pi-oven-foo/SKILL.md" ]
  [ -f "$PI_OVEN_PI_TEST_HOME/.omp/.pi-oven-shared/harness-share.md" ]
}
```

- [ ] **Step 3: Run to confirm failure**

```bash
bats tests/seed-skills.bats
```
Expected: 5 failures.

- [ ] **Step 4: Implement `install/lib/seed-skills.sh`**

```bash
#!/usr/bin/env bash
# Phase 2 — pi-oven seed. Sourced by install.sh.

PI_OVEN_PI_REPO_ROOT="${PI_OVEN_PI_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
PI_OVEN_PI_HARNESS_REPO="${PI_OVEN_PI_HARNESS_REPO:-https://github.com/kimzerokim/pi-oven.git}"

_seed_target_root() {
  if [ "${PI_OVEN_PI_MODE:-}" = "project" ]; then
    echo "$(pwd)/.omp"
  else
    echo "${XDG_CONFIG_HOME:-$HOME/.config}/omp"
  fi
}

_skill_version() {
  # Parse `version: X.Y.Z` from frontmatter.
  awk '/^---$/{f++; next} f==1 && /^version:/ {gsub(/^version: */, ""); print; exit}' "$1"
}

_fetch_harness() {
  if [ -n "${PI_OVEN_PI_FAKE_HARNESS_SRC:-}" ]; then
    echo "$PI_OVEN_PI_FAKE_HARNESS_SRC"
    return
  fi
  local dir
  dir="$(mktemp -d)/pi-oven"
  git clone --depth 1 "$PI_OVEN_PI_HARNESS_REPO" "$dir" >/dev/null 2>&1 \
    || pi-oven_pi_die "Phase 2: git clone $PI_OVEN_PI_HARNESS_REPO failed."
  echo "$dir"
}

src="$(_fetch_harness)"
target="$(_seed_target_root)"
mkdir -p "$target/skills" "$target/.pi-oven-shared"

# Sync each pi-oven-* skill
for src_skill_dir in "$src/skills/pi-oven-"*/; do
  name="$(basename "$src_skill_dir")"
  local_skill_md="$target/skills/$name/SKILL.md"
  src_skill_md="$src_skill_dir/SKILL.md"
  [ -f "$src_skill_md" ] || continue

  src_ver="$(_skill_version "$src_skill_md" 2>/dev/null || echo "0.1.0")"

  if [ -f "$local_skill_md" ]; then
    local_ver="$(_skill_version "$local_skill_md" 2>/dev/null || echo "0.1.0")"
    if printf '%s\n%s\n' "$src_ver" "$local_ver" | sort -V -C \
      && [ "$src_ver" != "$local_ver" ]; then
      # local > source → preserve
      pi-oven_pi_info "skipped $name — local v$local_ver > source v$src_ver"
      continue
    fi
  fi

  mkdir -p "$target/skills/$name"
  cp -R "$src_skill_dir"* "$target/skills/$name/"
  pi-oven_pi_info "synced $name (source v$src_ver)"
done

# Unconditionally overwrite harness-share.md
cp "$src/harness-share.md" "$target/.pi-oven-shared/harness-share.md"
pi-oven_pi_info "synced harness-share.md"

# Drift cleanup
orphans=()
for local_skill_dir in "$target/skills/pi-oven-"*/; do
  [ -d "$local_skill_dir" ] || continue
  name="$(basename "$local_skill_dir")"
  if [ ! -d "$src/skills/$name" ]; then
    orphans+=("$name")
  fi
done

if [ "${#orphans[@]}" -gt 0 ]; then
  pi-oven_pi_warn "Phase 2: local-only pi-oven-* found: ${orphans[*]}"
  if [ "${PI_OVEN_PI_ASSUME_YES:-0}" = "1" ]; then
    ans="y"
  else
    read -r -p "[pi-oven] Remove orphans? [y/N] " ans
  fi
  case "$ans" in
    y|Y|yes)
      for o in "${orphans[@]}"; do
        rm -rf "$target/skills/$o"
        pi-oven_pi_info "removed orphan $o"
      done
      ;;
    *) pi-oven_pi_info "Phase 2: kept orphans." ;;
  esac
fi
```

- [ ] **Step 5: Run tests to verify pass**

```bash
bats tests/seed-skills.bats
```
Expected: all 5 pass.

- [ ] **Step 6: Commit**

```bash
git add install/lib/seed-skills.sh tests/seed-skills.bats tests/fixtures/
git commit -m "feat(installer): Phase 2 pi-oven seed with version-aware sync + drift cleanup"
```

---

## Task 6: Routing block generator + CLAUDE.md merge

**Files:**
- Create: `install/lib/render-routing-block.sh`
- Create: `install/templates/routing-block.md`
- Create: `tests/routing-block.bats`

- [ ] **Step 1: Write template**

Create `install/templates/routing-block.md`:

```markdown
<!-- pi-oven:start -->
## Active Skills (pi-oven)

> Managed by `pi-oven install/update`. Do not edit between markers.
> Outside markers is preserved byte-for-byte.

Source of truth: `<HARNESS_SHARE_PATH>`

| Skill | Trigger keywords |
|---|---|
<SKILL_TABLE_ROWS>

### Adapter tools (`@pi-oven/pi-omp-adapter`)

- `codexReview` — cross-vendor plan/spec review (ChatGPT-sub → opencode-zen fallback)
- `crgQuery` — code-review-graph queries with freshness gate
- `playwrightVerify` — Gate 4 UI smoke via omp browser

More: github.com/kimzerokim/pi-oven
<!-- pi-oven:end -->
```

- [ ] **Step 2: Write failing tests**

Create `tests/routing-block.bats`:

```bash
#!/usr/bin/env bats
load 'lib/_setup'

setup() {
  setup_install_tmpdir
  export PI_OVEN_PI_FAKE_HARNESS_SRC="$REPO_ROOT/tests/fixtures/fake-pi-oven"
  export PI_OVEN_PI_MODE=global
  bash -c ". $REPO_ROOT/install/lib/log.sh; . $REPO_ROOT/install/lib/state.sh; . $REPO_ROOT/install/lib/seed-skills.sh"
}
teardown() { teardown_install_tmpdir; }

@test "routing-block: generates valid markdown with skill table" {
  run bash -c ". $REPO_ROOT/install/lib/log.sh; . $REPO_ROOT/install/lib/state.sh; . $REPO_ROOT/install/lib/render-routing-block.sh"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "<!-- pi-oven:start -->" ]]
  [[ "$output" =~ "<!-- pi-oven:end -->" ]]
  [[ "$output" =~ "pi-oven-foo" ]]
  [[ "$output" =~ "foo trigger" ]]
  [[ "$output" =~ "harness-share.md" ]]
}

@test "routing-block merge: fresh CLAUDE.md created when absent" {
  target_md="$HOME/.claude/CLAUDE.md"
  mkdir -p "$(dirname "$target_md")"
  PI_OVEN_PI_CLAUDE_MD="$target_md" \
    run bash -c ". $REPO_ROOT/install/lib/log.sh; . $REPO_ROOT/install/lib/state.sh; . $REPO_ROOT/install/lib/render-routing-block.sh; pi-oven_pi_merge_routing_block"
  [ "$status" -eq 0 ]
  [ -f "$target_md" ]
  grep -q "<!-- pi-oven:start -->" "$target_md"
  grep -q "<!-- pi-oven:end -->" "$target_md"
}

@test "routing-block merge: preserves content outside markers" {
  target_md="$HOME/.claude/CLAUDE.md"
  mkdir -p "$(dirname "$target_md")"
  cat > "$target_md" <<'EOF'
# My existing instructions

Some user content here.
EOF
  PI_OVEN_PI_CLAUDE_MD="$target_md" \
    bash -c ". $REPO_ROOT/install/lib/log.sh; . $REPO_ROOT/install/lib/state.sh; . $REPO_ROOT/install/lib/render-routing-block.sh; pi-oven_pi_merge_routing_block"
  grep -q "Some user content here" "$target_md"
  grep -q "<!-- pi-oven:start -->" "$target_md"
}

@test "routing-block merge: replaces existing marker block, leaves outside intact" {
  target_md="$HOME/.claude/CLAUDE.md"
  mkdir -p "$(dirname "$target_md")"
  cat > "$target_md" <<'EOF'
# Header
<!-- pi-oven:start -->
old content
<!-- pi-oven:end -->
# Footer (user content)
EOF
  PI_OVEN_PI_CLAUDE_MD="$target_md" \
    bash -c ". $REPO_ROOT/install/lib/log.sh; . $REPO_ROOT/install/lib/state.sh; . $REPO_ROOT/install/lib/render-routing-block.sh; pi-oven_pi_merge_routing_block"
  grep -q "# Header" "$target_md"
  grep -q "# Footer (user content)" "$target_md"
  ! grep -q "old content" "$target_md"
  grep -q "pi-oven-foo" "$target_md"
}
```

- [ ] **Step 3: Run to confirm failure**

```bash
bats tests/routing-block.bats
```
Expected: 4 failures.

- [ ] **Step 4: Implement `install/lib/render-routing-block.sh`**

```bash
#!/usr/bin/env bash
# Routing block generator + CLAUDE.md merge helper. Sourced by install.sh.

PI_OVEN_PI_REPO_ROOT="${PI_OVEN_PI_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

_seed_target_root() {
  if [ "${PI_OVEN_PI_MODE:-}" = "project" ]; then
    echo "$(pwd)/.omp"
  else
    echo "${XDG_CONFIG_HOME:-$HOME/.config}/omp"
  fi
}

_default_claude_md() {
  if [ "${PI_OVEN_PI_MODE:-}" = "project" ]; then
    echo "$(pwd)/CLAUDE.md"
  else
    echo "$HOME/.claude/CLAUDE.md"
  fi
}

_extract_triggers() {
  # Pull "Required triggers — ..." from frontmatter description.
  awk '/^description:/ {sub(/^description: */, ""); print; exit}' "$1"
}

pi-oven_pi_render_routing_block() {
  local target_root="$(_seed_target_root)"
  local template="$PI_OVEN_PI_REPO_ROOT/install/templates/routing-block.md"
  local harness_share="$target_root/.pi-oven-shared/harness-share.md"

  local rows=""
  for d in "$target_root/skills/pi-oven-"*/; do
    [ -d "$d" ] || continue
    local name="$(basename "$d")"
    local triggers="$(_extract_triggers "$d/SKILL.md" || echo "")"
    rows="$rows| \`$name\` | $triggers |"$'\n'
  done

  sed -e "s|<HARNESS_SHARE_PATH>|$harness_share|" "$template" \
    | awk -v rows="$rows" '
        /<SKILL_TABLE_ROWS>/ { printf "%s", rows; next }
        { print }
      '
}

pi-oven_pi_merge_routing_block() {
  local target="${PI_OVEN_PI_CLAUDE_MD:-$(_default_claude_md)}"
  local block
  block="$(pi-oven_pi_render_routing_block)"
  mkdir -p "$(dirname "$target")"

  if [ ! -f "$target" ]; then
    printf '# Instructions\n\n%s\n' "$block" > "$target"
    pi-oven_pi_info "routing block: created fresh $target"
    return
  fi

  if grep -q '<!-- pi-oven:start -->' "$target"; then
    # Replace existing block
    local tmp
    tmp="$(mktemp)"
    awk -v block="$block" '
      /<!-- pi-oven:start -->/ { in_block=1; print block; next }
      /<!-- pi-oven:end -->/   { in_block=0; next }
      !in_block { print }
    ' "$target" > "$tmp"
    mv "$tmp" "$target"
    pi-oven_pi_info "routing block: refreshed in $target"
  else
    # Append
    printf '\n%s\n' "$block" >> "$target"
    pi-oven_pi_info "routing block: appended to $target"
  fi
}

# When sourced standalone (e.g. via tests), print to stdout for inspection
if [ "${BASH_SOURCE[0]}" = "${0:-}" ] || [ "${PI_OVEN_PI_RENDER_ONLY:-0}" = "1" ]; then
  pi-oven_pi_render_routing_block
fi
```

Note: When sourced from `install.sh`, both functions are exported but neither runs automatically. install.sh will call `pi-oven_pi_merge_routing_block` after Phase 2. When tests source the file directly with no flag, the bottom block detects standalone use and prints the block to stdout — adjust the tests above to set `PI_OVEN_PI_RENDER_ONLY=1` or call the function explicitly. (Tests in Step 2 already call `pi-oven_pi_merge_routing_block` directly, satisfying this.)

- [ ] **Step 5: Run tests to verify pass**

```bash
bats tests/routing-block.bats
```
Expected: all 4 pass.

- [ ] **Step 6: Commit**

```bash
git add install/lib/render-routing-block.sh install/templates/routing-block.md tests/routing-block.bats
git commit -m "feat(installer): routing block generator + CLAUDE.md marker merge"
```

---

## Task 7: Wire routing block into install.sh + dogfood CLAUDE.md

**Files:**
- Modify: `install.sh`
- Create: `CLAUDE.md`

- [ ] **Step 1: Write the dogfood CLAUDE.md (with marker block placeholder)**

Create `CLAUDE.md` at repo root:

```markdown
# pi-oven — Distribution CLAUDE.md

> 이 파일은 pi-oven 의 _distribution CLAUDE.md_ 입니다.
> - 이 repo (github.com/kimzerokim/pi-oven) 안에서 Claude Code 가 열면 dogfood 워크플로우로 작동
> - `pi-oven install` 이 사용자 머신에 배포할 때도 이 파일이 SoT — 별도 template 없음
> - marker 블록 (`<!-- pi-oven:start ... end -->`) 만이 사용자 CLAUDE.md 와 합쳐지는 부분
> - marker 바깥 영역은 dogfood 전용

## Dogfood-only conventions

- `install.sh` 수정 시 `tests/install-flow.bats` 통과 필수
- adapter 변경 시 `packages/omp-adapter/` 에서 `bun test` 통과 필수
- 새 `pi-oven-*` 스킬은 upstream (`kimzerokim/pi-oven`) 에 PR — 이 repo 는 자체 스킬 보관 X
- 모든 commit author: `kimzerokim <ky200223@gmail.com>` (이 repo 의 git config 가 강제)

<!-- pi-oven:start -->
<!-- Auto-generated by install/lib/render-routing-block.sh on install/update.
     Hand-edits between these markers are wiped on next sync. -->
<!-- pi-oven:end -->
```

- [ ] **Step 2: Modify install.sh to call routing block merge after Phase 2**

Edit `install.sh`, replace the Phase dispatch section with:

```bash
# Phase dispatch (Plan 1 covers 0-2; later plans add 3-6)
run_phase 0 preflight.sh
run_phase 1 install-omp.sh
run_phase 2 seed-skills.sh

# Routing block merge (runs after Phase 2)
# shellcheck source=install/lib/render-routing-block.sh
. "$SCRIPT_DIR/install/lib/render-routing-block.sh"
pi-oven_pi_merge_routing_block

pi-oven_pi_info "Plan 1 milestone complete (Phases 0-2 + routing block). Phases 3-6 ship in Plan 2-3."
```

- [ ] **Step 3: Add an end-to-end test**

Add to `tests/install-flow.bats`:

```bash
@test "install.sh --global end-to-end (mocked omp + fixture harness)" {
  fake_bin="$PI_OVEN_PI_TEST_HOME/bin"
  mkdir -p "$fake_bin"
  cat > "$fake_bin/omp" <<'SH'
#!/bin/sh
[ "$1" = "--version" ] && echo "1.0.0"
SH
  chmod +x "$fake_bin/omp"

  PATH="$fake_bin:$PATH" \
    PI_OVEN_PI_FAKE_HARNESS_SRC="$REPO_ROOT/tests/fixtures/fake-pi-oven" \
    PI_OVEN_PI_FAKE_UNAME="Darwin arm64" \
    PI_OVEN_PI_ASSUME_YES=1 \
    run bash "$REPO_ROOT/install.sh" --global

  [ "$status" -eq 0 ]
  [ -f "$XDG_CONFIG_HOME/omp/skills/pi-oven-foo/SKILL.md" ]
  [ -f "$XDG_CONFIG_HOME/omp/.pi-oven-shared/harness-share.md" ]
  [ -f "$HOME/.claude/CLAUDE.md" ]
  grep -q "<!-- pi-oven:start -->" "$HOME/.claude/CLAUDE.md"
}
```

- [ ] **Step 4: Run all tests**

```bash
bats tests/
```
Expected: all green (5 + 3 + 5 + 4 + 4 = 21 tests).

- [ ] **Step 5: Commit**

```bash
git add install.sh CLAUDE.md tests/install-flow.bats
git commit -m "feat(installer): wire routing block + dogfood CLAUDE.md at repo root"
```

---

## Task 8: README finishing + v0.1.0 tag

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update README with what works now**

Replace `README.md`:

```markdown
# pi-oven

oh-my-pi runtime + pi-oven workflow, in one install.

## v0.1.0 — Installer Foundation

Plan 1 milestone. Phase 0-2 work end-to-end:

- Phase 0: Preflight (OS/arch, mode, deps)
- Phase 1: omp install / upgrade (mocked in tests; real install via `curl omp.sh`)
- Phase 2: pi-oven clone + version-aware skill sync + drift cleanup
- Routing block merge into `~/.claude/CLAUDE.md` (global) or `<proj>/CLAUDE.md` (project)

Phase 3-6 (adapter install, CRG, providers, sanity check) ship in Plan 2-3.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/kimzerokim/pi-oven/main/install.sh \
  | sh -s -- --global
```

CI/Docker only — interactive prompts disabled. For day-to-day use, see
`docs/install/prompt-claude-code.md` (ships in Plan 3).

## Modes

- `--global` (recommended): writes to `~/.config/omp/` + `~/.claude/CLAUDE.md`
- `--project`: writes to `<cwd>/.omp/` + `<cwd>/CLAUDE.md`. Requires cwd to be a project root.

## Tests

```bash
bats tests/
```

## Spec & Plans

- Design spec: `docs/superpowers/specs/2026-05-26-pi-oven-design.md`
- Plan 1 (this milestone): `docs/superpowers/plans/2026-05-26-pi-oven-plan-1-installer-foundation.md`
```

- [ ] **Step 2: Update CHANGELOG**

Replace `CHANGELOG.md`:

```markdown
# Changelog

## v0.1.0 — 2026-05-26

### Added
- `install.sh` + Phase 0/1/2 dispatch
- `install/lib/{log,state,preflight,install-omp,seed-skills,render-routing-block}.sh`
- `install/templates/routing-block.md`
- `install/lib/min-versions.json`
- Version-aware pi-oven skill sync with drift cleanup
- Marker-based CLAUDE.md routing block merge (preserves outside-marker bytes)
- bats-core test suite (`tests/preflight.bats`, `tests/install-omp.bats`, `tests/seed-skills.bats`, `tests/routing-block.bats`, `tests/install-flow.bats`)
- Dogfood CLAUDE.md at repo root

### Out of scope (Plan 2-3)
- `@pi-oven/pi-omp-adapter` TypeScript plugin
- Phase 3 (adapter install), Phase 4 (CRG install), Phase 5 (providers), Phase 6 (sanity check)
- `pi-oven` post-install CLI (update/status/uninstall/doctor)
- AI prompt docs (`docs/install/prompt-*.md`)
- CI workflows
```

- [ ] **Step 3: Final test sweep**

```bash
bats tests/
```
Expected: all green.

- [ ] **Step 4: Commit and tag**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: v0.1.0 — Plan 1 installer foundation milestone"
git tag -a v0.1.0 -m "Plan 1 — installer foundation (Phase 0-2 + routing block)"
git log --oneline -5
git tag --list
```

---

## Self-Review Checklist (for plan author)

**1. Spec coverage** — Plan 1 가 spec 의 어느 부분을 덮는가?
- §5.1 Entrypoints — terminal curl 만 (AI prompt 는 Plan 3)
- §5.2 Phases 0-2 — ✓
- §5.3 Mode write paths — ✓ (global + project 둘 다 테스트)
- §10 CLAUDE.md routing block + dogfood — ✓
- §9 Repo layout (Plan 1 범위) — ✓
- §13 Open questions — Plan 1 영역 (omp install/upgrade) 은 mock 으로 우회. 실제 omp 인스톨러 동작 확인은 manual smoke 으로 v0.1.0 release 직전 별도 진행.

미덮음 (의도적, Plan 2-3 로 미룸):
- Phase 3-6
- Adapter API
- update/uninstall flow
- AI prompt docs
- CI

**2. Placeholder scan** — TBD/TODO 없음. 코드 전부 actual.

**3. Type/name consistency** — 함수명·env var 명·파일 경로 모두 일관:
- `pi-oven_pi_*` prefix
- `PI_OVEN_PI_*` env var (`PI_OVEN_PI_MODE`, `PI_OVEN_PI_REPO_ROOT`, `PI_OVEN_PI_FAKE_HARNESS_SRC`, `PI_OVEN_PI_FAKE_UNAME`, `PI_OVEN_PI_ASSUME_YES`, `PI_OVEN_PI_RESUME`, `PI_OVEN_PI_DRY_RUN`, `PI_OVEN_PI_SKIP_PHASES`, `PI_OVEN_PI_OMP_INSTALL_CMD`, `PI_OVEN_PI_CLAUDE_MD`, `PI_OVEN_PI_HARNESS_REPO`, `PI_OVEN_PI_RENDER_ONLY`)
- `_seed_target_root` defined identically in `seed-skills.sh` and `render-routing-block.sh` — DRY violation but acceptable for v0.1; Plan 3 refactors into shared `install/lib/paths.sh`.

---

**End of Plan 1.**
