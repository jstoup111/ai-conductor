# Conflict Check: a-trace-cannot-be-tied-to-the-commit-pr-or-issue-t

**Date:** 2026-10-02
**Stories checked:** `.docs/stories/a-trace-cannot-be-tied-to-the-commit-pr-or-issue-t.md` (Stories 1–5) against all 528 files in `.docs/stories/`.
**ADR corpus:** `repo_wide` (from `conflict_check.adr_corpus`).
**Result:** PASSED — 0 blocking, 1 degrading (accepted by operator).

## ADR corpus

**Examined (subject overlaps telemetry, run terminal events, rebase outcome events, or OTel config):**
- `adr-014-otel-observability-exporter` (incl. 2026-10-02 D18–D20) — governing; stories derive from it.
- `adr-2026-08-11-halt-events-ride-the-persisted-spine` — D2 "`loop_halt` gains an optional `step`, stamped centrally" is the seam Story 1 reuses; compatible.
- `adr-2026-09-10-shared-step-lifecycle-telemetry` — D5 keeps execution identity off metric labels; Stories 3–5 add nothing to metric labels; compatible.
- `adr-2026-07-21-demote-task-stamping-to-telemetry`, `adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation` — task telemetry; no shared field.
- `adr-2026-06-30-owner-provenance-recording` — owner identity, not run provenance; Story 5 exports no operator identity; compatible.
- Rebase family (`adr-2026-07-08-post-rebase-gate-first-mechanical-reverify`, `adr-2026-07-20-post-rebase-delta-aware-invalidation`, `adr-2026-09-11-selective-post-rebase-verification`, `adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history`) — Story 2 only adds an optional field to outcome events; no outcome classification changes.

**Narrowed out (no subject overlap):** all remaining approved ADRs — build_review, seal, intake, daemon scheduling, release, provider, and finish-publication decisions. No supersession parsing excluded any examined ADR.

## Story pairs examined

| Existing story | Shared surface | A→B / B→A | Outcome |
|---|---|---|---|
| `trace-root-span-records-no-run-outcome-a-halted-ru` (outcome once, late halt keeps `complete`, force-close `terminated`, root span unexported until terminal) | root-span close path | holds / holds | compatible — Story 4 stamps at the same single close; force-close maps to `unrecorded` |
| `operators-cannot-attach-their-own-metadata-to-expo` (reserved `conductor.` prefix refused; metric Resource exact keys) | Resource keys, `otel` block | holds / holds | compatible — `conductor.source.ref` is engine-owned; metric Resource untouched |
| `stamp-released-harness-version-on-otel-trace-resou` (metric Resource exact key set) | metric Resource | holds / holds | compatible |
| `every-project-reports-the-same-otel-identity-so-me`, `daemon-dispatched-builds-emit-no-otel-telemetry-th`, `otel-observability` (trace Resource carries `conductor.feature`) | trace Resource `conductor.feature`, `service.instance.id` | see conflict below | degrading |

## Conflict: `feature: false` removes a trace Resource attribute that earlier stories assert unconditionally

**Stories involved:** Story 5 (Provenance export is configurable) vs daemon-dispatched-builds Story (resource carries `conductor.feature`) and every-project-reports-the-same-otel-identity (span Resource carries `conductor.feature`)
**Files:** `.docs/stories/a-trace-cannot-be-tied-to-the-commit-pr-or-issue-t.md` vs `.docs/stories/daemon-dispatched-builds-emit-no-otel-telemetry-th.md`, `.docs/stories/every-project-reports-the-same-otel-identity-so-me.md`
**Type:** overlap
**Severity:** degrading

**Description:** The earlier stories state "its resource carries conductor.feature=S" and "the span Resource additionally carries `conductor.feature`" with no configuration qualifier. Story 5 says that under `otel.provenance.feature: false` the trace Resource carries no `conductor.feature`. Both hold under the default (`feature: true`), so no build gate oscillates: the earlier stories' tests run with default config. They diverge only for an operator who opts out. Confidence 90% (verified by reading both criteria; inferred that existing tests use default config).

Pre-existing note, not caused by this spec: `every-project-reports-the-same-otel-identity-so-me` line 50 asserts span and metric Resources share one `service.instance.id`; main already scopes trace identity to the feature (`resource.ts`, 2026-08-28 amendment), so that criterion is already stale on main. This spec does not change that.

**Resolution Options:**
1. Accept as degrading: the earlier stories describe default-config behavior; ADR-014 D20 records the opt-out exception.
2. Qualify the earlier stories in place with "under default `otel.provenance`" — requires a companion main-based stories PR because the land stem gate refuses foreign-stem story edits.
3. Drop the `feature` toggle.

**Recommendation:** Option 1 — the default preserves every earlier assertion, and D20 is the authoritative record of the exception.

**Operator resolution (2026-10-02):** Option 1 accepted.
