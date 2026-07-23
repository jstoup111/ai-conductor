# Complexity Assessment: Guard engineer signals from test pollution

**Source-Ref:** jstoup111/ai-conductor#861

## Tier: S

## Signals (same axes conduct uses)

| Axis | Reading |
| --- | --- |
| Data models / schema | None. No new types, no signal-schema change. |
| Integrations | None. No new external service or seam. |
| Auth | None. |
| State machines | None. |
| Story count | 4 (happy redirect, concurrent-real-run negative, detection tripwire, quarantine cleanup). |
| Files touched | ~3 in `src/conductor/test/` (extend `setup.ts`, extend `global-setup.ts`, add a small `signals-leak-guard.ts` module mirroring `pipeline-leak-guard.ts`) + one maintenance script under `bin/` + docs. |
| New runtime behavior | None in production code. The prevention is a process-scoped test env var; the detection is a test-only globalSetup guard; the cleanup is an operator-run script. |

## Rationale

Pure test-environment hygiene plus a one-time, operator-invoked cleanup. The fix
extends two existing test-hygiene mechanisms (`test/setup.ts` env kill-switches and
`test/global-setup.ts` leak guard) that already encode this exact "tests must not
touch a real resource" pattern — no new architecture, no product surface, no
production code path changes. It sits squarely in the Small band.

## Tier-driven skips (per engineer flow)

- SKIP `/prd` (technical track).
- SKIP `/architecture-diagram` (Small).
- SKIP `/architecture-review` and ADRs (Small).
- SKIP `/conflict-check` (Small).

No architecture/decision/conflict artifacts are authored, and the land gate's
tier/artifact-mismatch check is satisfied because tier = S.
