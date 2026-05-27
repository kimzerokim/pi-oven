# Autonomous Run — User Decision Queue

Per `docs/specs/2026-05-27-pi-oven-foundation-design.md` Section 3 (Layer 4) + pi-oven `user-queue` 패턴. 자율 실행 중 ambiguous decision 또는 외부 의존성 누락 시 Pending entry append + 사용자 복귀 시 batch resolve.

---

## Pending

### Q-OMP-NOT-INSTALLED-001

- **Date:** 2026-05-27
- **Cycle:** Plan 0 Task 7
- **Trigger:** `which omp` → not found; `~/.omp/` 디렉토리 없음
- **Context:** Plan 0 Task 7 (omp marketplace add + plugin install verify) 의 verification step 들이 omp CLI 부재로 수행 불가.
- **Tentative default:** skip Task 7.1–7.5 (omp ops), continue Task 8 (final commit + tag + STOP). Catalog 는 GitHub 에 publish 되어 있어 omp 사용자가 자기 환경에서 `omp plugin marketplace add kimzerokim/pi-oven` + `omp plugin install pi-oven@pi-oven-marketplace` 가능.
- **User action required at check-in:** 
  1. omp 설치 (`curl -fsSL https://omp.sh/install | sh` 또는 `bun install -g @oh-my-pi/pi-coding-agent`)
  2. `omp plugin marketplace add kimzerokim/pi-oven`
  3. `omp plugin install pi-oven@pi-oven-marketplace`
  4. `ls -la ~/.omp/plugins/pi-oven/` 확인 → pi-oven 디렉토리 존재
  5. lockfile entry 확인: `cat ~/.omp/plugins/omp-plugins.lock.json | jq '.config.plugins."pi-oven" // .plugins."pi-oven"'`
- **Status:** Pending (사용자 복귀 시 resolve)

---

## Resolved

(none)
