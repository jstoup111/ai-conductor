# ADR 2026-07-22 — Per-task "work happened at all" floor under build_review

**Status: APPROVED**
**Stem:** `per-task-work-happened-floor` · Source: jstoup111/ai-conductor#781 (follow-up #773)
**Tier:** M (lightweight review) · **Date:** 2026-07-22

## Context

#773 removed the mechanical per-task evidence-ledger **gate** (a false-negative wedge
machine) and made `build_review`'s LLM completeness rubric the completion authority.
The LLM has an inverse, unproven **false-positive** risk: judging a build complete when
a planned task produced zero commits and had no marker. #781 asks for a deterministic,
wedge-free floor that catches that case and composes UNDER `build_review` as a cheap
first pass — WITHOUT reviving any deleted wedge class (no path-corroboration, dirname
matching, SHA reachability, or pinned stamps).

**Hard constraint (guardrail + #773 thesis):** the floor must not be able to block
legitimately-complete work.

**Load-bearing evidence (CONFIRMED):** the real #773 incident commit `93c2a3e3`
(tasks 6 & 7) carries **`Task: 7` only**. Task 6's paired work was folded into that
single commit with no `Task: 6` trailer. This is decisive: a per-task-trailer floor
that BLOCKS would have false-blocked task 6 — i.e., a blocking floor demonstrably
revives the #773 wedge on a real, reproduced case.

## Decision

Implement the floor as a **standalone deterministic advisory**, computed inside the
`build_review` step (in `runBuildReview`, before the isolated grader dispatch):

- **Signal (wedge-free):** a planned task id (from `parsePlanTaskPaths`) is *covered*
  if ≥1 commit on the branch carries a `Task:` trailer matching it under
  `canonicalTaskId` folding; it is *marked* if it has a `**Verify-only:** yes` /
  `**Type:** verification` plan marker (via the existing `parsePlanTaskVerifyOnly`) OR
  a `status: 'skipped'` row in `task-status.json`. A **gap** is a task that is neither
  covered nor marked.
- **Disposition:** NON-BLOCKING. The floor writes `.pipeline/per-task-floor.json`
  (telemetry) and emits WARNING advisory lines into the build output for each gap
  ("task N produced no commit carrying its Task: trailer and no verify-only/skip
  marker — confirm its work shipped inside another task's commit or add a marker").
  It does NOT alter the grader's verdict, does NOT inject into `buildGraderPrompt`,
  and does NOT trigger a kickback.
- **Fail-soft:** any git/parse error → `skipNotes`, `satisfied: true`, zero gaps.
- **Kill-switch:** optional additive `build_review.perTaskFloor` (default on).

The floor is the cheap deterministic "did work happen at all" first pass; the LLM
completeness rubric remains the semantic "was it sufficient" authority. Belt-and-
suspenders, not a replacement.

## Alternatives considered (and rejected)

### Alt A — Blocking native kickback gate (wiring_check-style)
Compute the same signal but make a gap **block**: write a non-daemon-gated kickback to
`build` (mirroring the deterministic `wiring_check` loop at `conductor.ts:4119`).
**Rejected.** Directly revives a deleted wedge class: commit `93c2a3e3` proves paired
tasks legitimately fold into one commit carrying one task's trailer; the un-trailered
sibling would false-block. Trailer stamping is also now telemetry-only (best-effort git
hook) — any stamping gap would wedge complete work. Violates the hard guardrail and the
#773 thesis. The determinism win is not worth resurrecting the exact failure #773 fixed.

### Alt B — Inject floor findings into the build_review grader prompt
Feed the gap list into `buildGraderPrompt` so the LLM adjudicates it.
**Rejected.** The grader prompt explicitly FORBIDS per-task reasoning ("never chase
individual task SHAs, verify per-task commit reachability, or look for corroborating
evidence … the failure mode this gate exists to avoid reintroducing") and is
input-isolated by contract (diff + plan only). Injecting per-task trailer findings
would contradict that contract and re-introduce per-task reasoning into the very gate
built to avoid it. Keeping the floor OUT of the grader preserves both contracts.

### Alt C — Own blocking gate only in the "unambiguous" subset
Block only when a task's work provably could not be folded elsewhere.
**Rejected.** "Could not be folded" requires semantic judgment over the diff — that is
exactly the LLM grader's job and cannot be computed deterministically. There is no
wedge-free deterministic subset that safely blocks.

## Consequences

- **Positive:** restores a *mechanical, deterministic* per-task signal beneath the LLM
  gate; second (independent) line of defense against a silent zero-commit skip; zero
  wedge risk; reuses existing parsers; no schema/CLI/hook breaking change.
- **Accepted trade-off (honest):** the advisory is *coarse* — a folded-work task (like
  #773's task 6) is flagged as a gap even though its work shipped. Because the floor is
  non-blocking, this is surfaced *noise/a prompt to confirm*, never a false halt. The
  rendered wording frames gaps as "confirm or mark", not as assertions of incompleteness.
  Plan authors silence a genuinely no-commit task with a `**Verify-only:** yes` marker.
- **Future work (out of scope):** if field data shows the false-positive-gap rate is
  ~zero, a follow-up could promote the advisory to a config-gated block. Not this spec.

## Compliance with #781 desired outcomes

1. Deterministic wedge-free signal (trailer OR marker, no path/dirname/SHA/pin). ✅
2. Zero-commit unmarked task surfaced before ship (WARNING + artifact). ✅ (flagged)
3. Legitimately test-only task doesn't wedge — non-blocking + marker escape. ✅
4. Composes UNDER build_review as a cheap first pass; LLM keeps semantic judgment. ✅
