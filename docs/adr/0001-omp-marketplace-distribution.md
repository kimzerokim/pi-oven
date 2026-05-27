# ADR 0001 — omp Marketplace as Sole Distribution Channel

- **Date:** 2026-05-27
- **Status:** Accepted
- **Context:** pi-oven 의 install / upgrade / uninstall 메커니즘 결정 필요.

## Decision

pi-oven 의 sole distribution mechanism = **omp marketplace** (`.claude-plugin/marketplace.json` 호환 catalog, GitHub repo self-hosted). 자체 인스톨러 / npm direct mirror (v1) / commercial registry 없음.

## Rationale

1. omp marketplace 가 bun-install 백엔드 + lockfile + version-pin + scope (user/project) + feature flags 모두 처리 → 우리가 멱등성 / upgrade / rollback 인프라 새로 만들 필요 없음.
2. 이전 design (Plan 1 installer foundation, 1313 LoC) 가 SUPERSEDED 된 이유 = omp marketplace 가 그 책임 흡수.
3. catalog 가 GitHub repo self-reference → catalog + plugin source 같은 repo 안 동거 (가장 단순).
4. Cross-harness 자동 디스커버리 (omp 가 `.claude/`, `.cursor/`, `.codex/` 등 디스커버리) → pi-oven markdown 자원 자동 cross-harness 부산물.

## Consequences

- npm publish 는 v2 옵션 (현재 skip)
- catalog `plugins[]` = 1 entry (pi-oven 자신). sub-plugin 분할 없음 (Q1 successor 단일 layer 결정과 align)
- single-plugin publisher 정체성. marketplace operator / plugin scoring / commercial layer 없음.

## Alternatives Considered

- Self-hosted installer (Plan 1 SUPERSEDED): 인프라 부담 + omp marketplace 와 중복
- npm direct (`bun install -g @pi-oven/pi`): omp 가 npm source 도 지원하지만 marketplace 단순성 우선
- Multi-marketplace (pi-oven-core / superpowers-port 분할): Q1 successor 결정 충돌

## Spec Reference

`docs/specs/2026-05-27-pi-oven-foundation-design.md` Section 4 (Install Lifecycle)
