---
name: omp-install-layout
description: omp v15.5.3 가 marketplace plugin 을 install 하는 실제 디렉토리 + 메타 파일 layout
confidence: high
captured: 2026-05-27
source: Plan 0 verify session (Q-OMP-NOT-INSTALLED-001 resolve)
---

# omp Install Layout (v15.5.3, observed)

## Action

omp plugin marketplace + install 후 다음 layout 을 **실제 사실** 로 인정. Design spec 의 가정 (path / lockfile name) 이 다르면 spec 을 정정.

## Evidence (observed 2026-05-27 17:07)

```
~/.omp/plugins/
├── installed_plugins.json     ← v2 schema, NOT 'omp-plugins.lock.json'
└── cache/
    ├── marketplaces/<marketplace-name>/    ← catalog cache
    └── plugins/<marketplace>___<plugin>___<version>/   ← actual plugin install
```

`installed_plugins.json` content shape:
```json
{
  "version": 2,
  "plugins": {
    "<plugin>@<marketplace>": [
      {
        "scope": "user" | "project",
        "installPath": "/absolute/path/to/plugin/cache/dir",
        "version": "<semver>",
        "installedAt": "<iso8601>",
        "lastUpdated": "<iso8601>"
      }
    ]
  }
}
```

Plugin 자원 (skills/, agents/, commands/, .omp/, hooks/, rules/, evals/, .claude-plugin/, scripts/, README.md, LICENSE, models.yml, package.json, tsconfig.json) 가 모두 `cache/plugins/<marketplace>___<plugin>___<version>/` 에 git-subdir source 의 path 따라 복사됨.

## Why this matters

`docs/specs/2026-05-27-pi-oven-foundation-design.md` Section 1 "Persistence" + Section 4 "Catalog" 의 가정과 **차이**:
- spec 가정: `~/.omp/plugins/pi-oven/` (flat root layout)
- 실제: `~/.omp/plugins/cache/plugins/<3-segment-id>/` (cache subdir)
- spec 가정: `omp-plugins.lock.json` 으로 멱등성 SoT
- 실제: `installed_plugins.json` (v2) 로 multi-scope tracking

`omp marketplace.md` docs 와 실제 v15.5.3 동작이 drift. omp 가 docs publish 후 install layout 을 refactor 한 듯.

## How to apply

1. **Spec correction (Plan 1 또는 별도 ADR)**: Section 1 Persistence + Section 4 Catalog 의 path/lockfile 가정 수정.
2. **TS extension 의 plugin-root resolution**: hard-code 금지. omp SDK 의 plugin context 활용 또는 `installed_plugins.json` 읽어 `installPath` lookup.
3. **`/pi-oven:doctor`**: 실제 install path 자동 detection — `installed_plugins.json` parse + `installPath` field 사용.
4. **Eval result history path** (`docs/eval/history/`): 사용자 working repo 의 docs/ 위치 (변동 없음, 이미 OK).
5. **`.pi-oven/state/`**: 사용자 working repo 위치 (변동 없음, OK).

## Examples

```bash
# 사용자 working session 에서 plugin root 알아내기
jq -r '.plugins."pi-oven@pi-oven"[0].installPath' ~/.omp/plugins/installed_plugins.json

# Returns: /Users/<user>/.omp/plugins/cache/plugins/pi-oven___pi-oven___0.1.0
```

## Related

- Q-OMP-NOT-INSTALLED-001 (resolved) — origin context
- `docs/specs/2026-05-27-pi-oven-foundation-design.md` Section 1/4 — spec to correct
- Plan 1 / Plan 4 — apply fixes during scope expansion + setup wizard build
