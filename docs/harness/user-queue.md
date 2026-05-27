# Autonomous Run — User Decision Queue

Per `docs/specs/2026-05-27-pi-oven-foundation-design.md` Section 3 (Layer 4) + pi-oven `user-queue` 패턴. 자율 실행 중 ambiguous decision 또는 외부 의존성 누락 시 Pending entry append + 사용자 복귀 시 batch resolve.

---

## Pending

(none)

---

## Resolved

### Q-OMP-NOT-INSTALLED-001

- **Date opened:** 2026-05-27 (Plan 0 Task 7)
- **Date resolved:** 2026-05-27 (Plan 0 verify pass)
- **Original trigger:** `which omp` → not found; `~/.omp/` 디렉토리 없음
- **Resolution:** 사용자가 omp 직접 설치 (`curl -fsSL https://omp.sh/install | sh`, bun 1.3.12 → 1.3.14 업그레이드 동반). 이어서 `omp plugin marketplace add kimzerokim/pi-oven` + `omp plugin install pi-oven@pi-oven` 완료. 검증된 install 경로: `~/.omp/plugins/cache/plugins/pi-oven___pi-oven___0.1.0/` (Plan 1 종료 시점 v0.1.0 으로 upgrade 예정).
- **Side effect captured:** 실제 omp v15.5.3 install layout 이 spec assumption (`~/.omp/plugins/pi-oven/` + `omp-plugins.lock.json`) 과 달랐음 → `docs/instincts/omp-install-layout.md` 신규 작성, spec Section 4 수정 (commit `0736bf9`), `docs/adr/0001-omp-marketplace-distribution.md` Post-v0.1.0 Observed Layout 섹션 추가.
