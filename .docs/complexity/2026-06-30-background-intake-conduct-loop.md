# Complexity Assessment: Background Auto-Intake on the Conduct Loop

**Plan stem:** `2026-06-30-background-intake-conduct-loop`
**Date:** 2026-06-30

Tier: M

## Rationale

Signals (same as conduct's S/M/L heuristics):

- **Models / schema:** None new. Reuses the existing intake envelope, durable queue, and ledger.
- **Integrations:** Several existing seams wired together — the autonomous loop, the
  `github-issues` intake adapter (poll/ledger/source-ref), a push-notification mechanism, and a
  status surface. No brand-new external integration, but more than one touch point.
- **Auth:** None new (reuses `gh` auth already in the adapter).
- **State machines:** Minor — relies on the existing ledger state transitions plus
  capture/notify de-duplication; no new multi-state machine.
- **Correctness sensitivity:** Elevated. Source-reference threading (FR-8) and idempotent
  capture/notify (FR-2/FR-4/FR-12) are the kind of negative-path/derivation requirements that
  have historically hidden real bugs — these need adversarial tests at every call site.
- **Story count:** Estimated ~8–12 stories.

Not **Small**: multiple integration points (loop + notification + status), an auto-close
correctness chain, and per-repo failure isolation push it past a single-surface change.

Not **Large**: no new domain models, no new auth, no new external system, bounded surface.

## Implications (per engineer DECIDE tiering)
- conflict-check: **included**
- architecture-diagram: **included**
- architecture-review: **lightweight** (Medium) — must still resolve the open
  brain-loop-vs-per-repo-daemon ownership question and produce an APPROVED ADR for it.
