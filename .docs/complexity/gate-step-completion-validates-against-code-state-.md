# Complexity Assessment — Gate-step completion validates against code state, not timestamp

**Stem:** `gate-step-completion-validates-against-code-state-`
**Tier: M**
**Date:** 2026-07-22

## Signals

| Signal | Reading |
|---|---|
| New data models | None new; adds a `codeStamp` field to the existing `build-review.json` / verdict artifacts and (for the three swept steps) their evidence — reuses `EvidenceStamp`-style shape and the existing `GATE_SURFACE`/`partitionDelta` types |
| Integrations / external systems | None (pure git + filesystem, in-process; `git rev-parse` / diff already used by `gate-invalidation.ts`) |
| Auth / security surface | None |
| State machines | None new; hooks into the existing verdict completion predicates and the `sweepStaleReviewArtifacts` re-entry path |
| New engine modules | ~1 (a shared `gate-code-validity` helper) + wiring into `artifacts.ts` verdict predicates + `sweepStaleReviewArtifacts`; reuses `gate-invalidation.ts` |
| Config surface | 1 optional additive kill-switch (revert to pure-mtime freshness) |
| Story count | ~8 (preserve-on-unchanged, re-run-on-surface-change, fail-closed missing stamp, fail-closed unreachable/orphaned baseline (#766), kickback still invalidates, within-dispatch attempt-floor preserved, sweep respects valid stamp, legacy-verdict upgrade fallback) |
| Design fork | 1 genuine, load-bearing (validity signal + reuse-vs-new machinery, with the #766 orphan hazard as a hard guardrail) → needs an ADR |
| Docs surface | CHANGELOG + `README.md` + `src/conductor/README.md` (gate-resume behavior) |

## Rationale

Not **Small**: there is a real architectural fork — which code-validity signal (per-gate-surface delta
from a recorded baseline vs raw tree equality vs suppressing the floor reset vs exact-SHA pin) — with a
hard guardrail that must **not** revive the #766 SHA-orphan wedge and must **not** weaken the
fail-closed guarantee or the within-dispatch attempt-floor freshness (incident 2026-07-12). That
judgment is load-bearing, must be discharged by an ADR, and must be conflict-checked against the
existing post-rebase delta-aware invalidation (ADR-2026-07-20) and the verdict-freshness model
(#649/#652) it reuses/coexists with.

Not **Large**: no new data models, no integrations, no auth, no new state machine. The delta
computation, the `GATE_SURFACE` map, `partitionDelta`, and the fail-closed-on-uncomputable pattern all
already exist in `gate-invalidation.ts` — this generalizes them to a second call site. The change is one
focused shared helper plus wiring into the existing verdict predicates and the sweep, an additive stamp
field, and additive config/docs.

**Tier: M** ⇒ run `/architecture-diagram` (lightweight), `/architecture-review` (lightweight, one ADR),
`/stories`, `/conflict-check`, `/plan`. `/prd` skipped (technical track — acceptance criteria live in
stories). This tier drives the daemon's BUILD-phase step skipping; a non-Small spec must carry
conflict-check + architecture artifacts (present here).
