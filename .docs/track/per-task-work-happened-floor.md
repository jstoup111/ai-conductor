# Track Determination — Per-task "work happened at all" floor under build_review

**Stem:** `per-task-work-happened-floor`
**Source:** jstoup111/ai-conductor#781 (follow-up to #773)
**Track:** TECHNICAL
**Date:** 2026-07-22

## Problem statement (WHAT), not the sketch

#773 deleted the mechanical per-task evidence-ledger **gate** (a false-NEGATIVE
wedge machine — it halted genuinely-complete work on `Files:`-path mismatches) and
promoted `build_review`'s LLM completeness rubric to the sole completion authority,
backed by outcome gates (acceptance specs RED→GREEN, full suite, SHIP validators).
The LLM judge has the inverse, so-far-unproven risk: **false-POSITIVE** — it could
judge a build "complete" when a planned task was skipped entirely (produced zero
commits, no marker) and let silently-unimplemented work ship. The mechanical safety
net is gone; there is now one line of defense where there used to be two.

## Desired outcomes (the WHAT to satisfy)

1. A **deterministic, wedge-free** signal that each planned task either produced
   ≥1 commit OR carries an explicit verify-only/skip marker — computed WITHOUT
   path-corroboration, dirname matching, SHA reachability, or pinned stamps.
2. A build where a planned task produces zero commits and has no skip/verify-only
   marker is **surfaced (flagged or blocked) before ship**.
3. A legitimately test-only task (like #773's tasks 6 & 7) does NOT trip the floor —
   no false-negative wedge.
4. The floor **composes UNDER** `build_review`'s completeness rubric as a cheap first
   pass ("did work happen at all"), leaving the semantic "was it sufficient" judgment
   to the LLM — belt-and-suspenders, not a replacement.

## Filer hypotheses (candidates, NOT the chosen approach)

- H1: A per-task "≥1 commit carrying this task's `Task:` trailer, OR an explicit
  verify-only/skip marker" check as the cheapest deterministic floor.
- H2: Instead a **non-blocking advisory** that the LLM completeness rubric / operator
  consumes as a hint, rather than its own gate.

These are weighed in `/architecture-review`; H2's non-blocking framing is favored and
H1's blocking framing is rejected (see ADR) — but the trailer-OR-marker *signal* from
H1 is retained.

## Why TECHNICAL (not product)

- No user-facing product surface, no end-user requirement, no PRD acceptance criteria.
- Pure internal engine machinery: a deterministic computation over git commit trailers
  + plan-declared markers, surfaced at the `build_review` step of the daemon build loop.
- The only "user" is the harness operator (telemetry/log visibility) and the plan
  author (an existing `**Verify-only:**` / `**Type:** verification` authoring marker).
- Acceptance is expressed as engine behavior in `/stories` (Given/When/Then over the
  build loop), not as functional product requirements. `/prd` is therefore SKIPPED.

## Confirmed grounding (verify-claims)

- **CONFIRMED (direct git evidence):** the real #773 incident commit `93c2a3e3`
  (tasks 6 & 7) carries **`Task: 7` only** — task 6's paired work was folded into a
  single commit with no `Task: 6` trailer. A *blocking* per-task-trailer floor would
  have false-blocked task 6 → this reproduces the #773 wedge class. This is the
  load-bearing fact behind the advisory (non-blocking) decision.
- **CONFIRMED (code):** `parsePlanTaskVerifyOnly` already exists
  (`src/conductor/src/engine/autoheal.ts:626`) and parses `**Verify-only:** yes` and
  `**Type:** verification` markers; currently test-only, no live wiring — reused here.
- **CONFIRMED (code):** trailer read path (`listCommitsWithTrailers`, `canonicalTaskId`)
  and plan-id parse (`parsePlanTaskPaths`) exist and are the correct wedge-free inputs.

**Track = TECHNICAL. Proceed: complexity → architecture-diagram → architecture-review
→ stories → conflict-check → plan.**
