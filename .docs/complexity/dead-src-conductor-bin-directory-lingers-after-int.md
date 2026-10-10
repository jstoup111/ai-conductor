# Complexity: Dead src/conductor/bin/ directory lingers after intake-file moves into the skill (#2791)

**Issue:** #2791
**Plan stem:** `dead-src-conductor-bin-directory-lingers-after-int`

Tier: S

## Signals

| Signal | Reading |
|--------|---------|
| New models / schemas | None. |
| Integrations | None changed. The deleted file is outside type-checking (`src/conductor/tsconfig.json:13` `rootDir: "src"`, `:21` `include: ["src/**/*"]`) and has no caller: `git grep "src/conductor/bin"` on main outside `.docs/` hits only the file itself (verified). |
| Auth / secrets | None. |
| State machines | None. |
| Story count | 1 (surviving intake filing path). |
| Diff size | One file deleted (`src/conductor/bin/intake-file`, 3.5 KB); no other file changes. |

## Rationale

**Small.** A single-directory deletion whose reference cleanup already shipped with #742. No
architecture decision is introduced, so no diagram, ADR, conflict-check, or coherence artifact is
required. The surviving behavior (filing through the bundled `skills/intake/scripts/intake-file`
helper) is already covered by existing tests.
