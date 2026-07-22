# Track: Gate-step completion validates against code state, not evidence timestamp

**Source:** jstoup111/ai-conductor#817
Track: technical

_(Internal daemon/gate behavior — no product requirement, no user-facing change. Tier: Medium — see
`.docs/complexity/`.)_

## Problem statement (WHAT)

A re-dispatched feature **re-runs completed gate steps from scratch** because a judged gate's
completion evidence is invalidated by **wall-clock timestamp** (the evidence file's mtime must
post-date the current dispatch's session floor), not by whether the code the evidence was recorded
against actually changed. Every daemon re-dispatch overwrites the freshness floor
(`state.session_started_at = Date.now()`, `conductor.ts:1578-1581`), so a prior-session verdict —
byte-identical code, verdict still `PASS` — is scored stale and the gate re-runs. On a healthy build
that is ~17 min (`build_review`) burned per resume; it compounds with halt/re-dispatch churn.

Task-level build resume (`.pipeline/task-status.json`) already persists correctly and is **out of
scope** — it must keep working unchanged.

## Desired outcomes (verified acceptance signals)

- A re-dispatched feature does **not** re-run a judged gate step whose recorded verdict still validly
  reflects the current code (the code under that gate's surface is unchanged since the verdict).
- A gate re-runs **only** when something substantial changed since its verdict was recorded — code
  under the gate's surface changed, a kickback invalidated it, or the stamp is missing/uncomputable —
  **not** merely because a new dispatch started.
- Fail-closed protection is **preserved**: a verdict whose code stamp is missing, unreachable
  (rebase/reset-orphaned), or whose surface delta is uncomputable is still re-run; no stale or forged
  verdict may satisfy a gate.
- Task-level build resume (`task-status.json`) is unchanged.

## Discovery — grounded mechanism analysis (settles the "which gates, which mechanism" question)

All evidence gathered against `main` by direct read of `src/conductor/src/engine/`.

### The root lever — confirmed

`Conductor.run()` unconditionally re-stamps the freshness floor on **every** entry
(`conductor.ts:1578-1581`): `state.session_started_at = Date.now()`. `run_started_at` is preserved
(`if (!state.run_started_at)`), but `session_started_at` is clobbered. The daemon re-dispatch path
(`daemon-cli.ts:823-852` constructs `new Conductor({… resume:true …})`, runs at `:909`) therefore
moves the floor forward on each resume. Nothing carries the prior floor forward. This is why
prior-session gate evidence (older mtime) is scored stale on resume.

### The mtime-freshness victims — confirmed IN SCOPE

The verdict completion predicates in `artifacts.ts` reject evidence by mtime vs the moving floor
(`fileIsFreshSinceSession` at :108-119; floor via `verdictFreshnessFloor`/`verdictFreshnessComparand`
at :129-165):

- **`build_review`** — predicate `artifacts.ts:1442-1492`; compares `build-review.json` mtime to the
  attempt/session floor (`:1445,1447`). `BuildReviewVerdict` (`:883-890`) carries **no** code stamp
  today — a stamp must be added.
- **`prd_audit`** — predicate `artifacts.ts:1325-…`; same `verdictFreshnessComparand` floor.
- **`architecture_review_as_built`** — predicate `artifacts.ts:1381-…`; same floor.
- **`manual_test`** — session-floor mtime (`fileIsFreshSinceSession`, `:1242,1277`); also carries a
  HEAD-based FAIL→PASS guard (`headSha` marker) that is orthogonal and stays.

Additionally, `sweepStaleReviewArtifacts` (`artifacts.ts:338-355`) **actively deletes** prior-session
evidence for `STALE_SWEEP_STEPS = {manual_test, prd_audit, architecture_review_as_built}`
(`:314-318`) on kickback/failed re-entry (`conductor.ts:2730`, `group-core.ts:408`) — so for those
three, resume doesn't merely reject the evidence, it removes it.

All four gates are already declared in the **`GATE_SURFACE`** map (`gate-invalidation.ts:44-53`) with
a surface kind (`build_review:'any-codetest'`, `manual_test:'all-runtime'`,
`prd_audit:'feature-runtime'`, `architecture_review_as_built:'feature-runtime'`). That map is the
reuse point.

### Corrections to the filer's diagnosis — verified, reshape scope

The issue's Observed section names `acceptance_specs` and `wiring_check` as timestamp victims. Direct
reads show neither is:

1. **`wiring_check` is already code-anchored, not mtime-gated.** Its predicate
   (`artifacts.ts:1501-1580`) validates `wiring-evidence.json.head` against the current HEAD SHA
   (`validateWiringEvidence`, `:781-786`: *"evidence recorded for {head} but HEAD is {currentHead}"*).
   On a re-dispatch with unchanged HEAD it already **preserves** the evidence. It is the **precedent**
   for this spec, not a victim. **OUT OF SCOPE** (except as the design model).

2. **`acceptance_specs` has no mtime freshness guard at all.** Its predicate
   (`artifacts.ts:1163-1195`) is pure content validation (spec files present + `acceptance-specs-red.json`
   parses + `executed≥1, failed≥1, skipped==0, errors==0`). It reports *"...is missing"* **only when
   `readFile` throws** (genuine file absence) — never because of mtime. The issue's observed re-run is
   the `selfHealAcceptanceRed` pre-heal (`conductor.ts:2841-…`, from prior issue #733) firing on a
   **genuinely absent** RED marker — a distinct **evidence-durability** problem (evidence lost on
   worktree reuse/resume, cf. #497), NOT this timestamp bug. **OUT OF SCOPE — flagged below for a
   separate intake.**

**Confidence:** HIGH (verified by direct read of each predicate). This narrows the fix from "all gate
steps" to the four mtime-freshness-gated judged gates already in `GATE_SURFACE`, and prevents
speccing a change to `acceptance_specs`/`wiring_check` that would not address the observed cost there.

### The existing precedent to generalize — confirmed

`gate-invalidation.ts` + ADR-2026-07-20 (`adr-2026-07-20-post-rebase-delta-aware-invalidation.md`)
already implement exactly *"preserve gate G iff the code delta misses G's declared surface"* — but
**only on the rebase path** (`conductor.ts:5148-5186`, `rebase.ts:780`). It computes a delta,
partitions it by `GATE_SURFACE` (`partitionDelta`, `:71-88`), and **fails closed to invalidate-all
when the delta is uncomputable**. This spec **generalizes the same logic to the re-dispatch/resume
path**, with the delta baseline being each gate's own recorded code stamp instead of the rebase
pre-tree.

### The hazard to design around — confirmed (#766)

`task-evidence.ts` `EvidenceStamp.sha` pinned task completion to a raw commit SHA; when history was
reset/amended/discarded the SHA became unreachable and wedged an "uncreditable-undemotable" state
(#766, `sidecar-stamp-reachability-guard`). Lesson: **do not pin a gate to a specific commit SHA that
history rewriting can orphan.** The design must fail **closed to re-run** (never wedge) when the
stamped baseline is unreachable — the same fail-closed stance ADR-2026-07-20 takes for an uncomputable
delta, and the stance `wiring_check` already takes (mismatch → recompute).

## Approaches considered

- **A (CHOSEN): Generalize `GATE_SURFACE` delta-aware preservation to the re-dispatch path.** Stamp
  each judged verdict with the code baseline (HEAD SHA) it was recorded against; on completion check,
  if a valid `PASS` verdict has a stamp whose delta-to-current-HEAD misses the gate's surface, preserve
  it (no re-run). Reuse `partitionDelta`/`classifyGateInvalidation` + `GATE_SURFACE`. Fail closed to
  re-run on missing/unreachable/uncomputable stamp. Keeps the mtime **attempt-floor** for the
  within-dispatch "judge must rewrite its verdict when re-run" guard (incident 2026-07-12). Matches the
  repo's own precedent and the Design Principle (deterministic, reuse existing machinery).
- **B: Stamp a raw HEAD tree hash and require exact tree equality to preserve.** Rejected — any
  foreign/test-only change between dispatches would re-run every gate, losing most of the benefit
  (the whole point of `GATE_SURFACE` is that a gate only cares about *its* surface). Simpler but too
  coarse.
- **C: Stop re-stamping `session_started_at` on resume when nothing changed.** Rejected — one global
  floor for all gates is the wrong granularity: a foreign change under one gate's surface must not
  force another gate to re-run, and "nothing changed" is itself the per-gate-surface question that
  approach A answers correctly.
- **D: Pin each verdict to its commit SHA and preserve on exact-SHA match.** Rejected — revives the
  #766 orphan-wedge hazard directly (a rebase/reset orphans the SHA and either wedges or forces a
  re-run of everything).

## Out of scope (flagged for separate intake)

- **`acceptance_specs` RED-evidence durability on resume.** Its re-run is genuine `.pipeline/`
  evidence loss on worktree reuse (self-heal via `selfHealAcceptanceRed`), not a timestamp gate. It
  needs its own fix (evidence persistence/backfill, cf. #497) and should be a separate intake issue —
  this spec must not silently paper over it by adding a code-stamp there.
- **`wiring_check`** — already HEAD-anchored and correct; untouched (used only as the design model).
- **Task-level resume (`task-status.json`)** — already works; untouched.
- **The rebase-path invalidation (ADR-2026-07-20)** — reused, not modified; conflict-check confirms
  the two paths are complementary (different baselines, same `GATE_SURFACE`).
