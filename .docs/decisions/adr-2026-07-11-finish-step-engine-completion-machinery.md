---
status: APPROVED
date: 2026-07-11
approved: 2026-07-11
supersedes: none
amends: adr-2026-07-03-halt-pr-rehabilitation-at-finish (Decisions 1 and 2)
deciders: James Stoup
issues: "#499 (consolidates #368, #439, #281-residual lineage)"
---

# ADR: Finish-step completion becomes engine machinery (in-step presentation repair, hardened gate, surgical retry)

## Status
APPROVED (2026-07-11, operator-confirmed in engineer session)

## Context

The finish gate (`artifacts.ts:1105-1202`) detects every try-1 failure class precisely
but never acts on the mechanically-fixable ones. Observed 2026-07-10/11: try-1 finish
failure on 6 of 7 shipped features; PRs #452/#444/#494 rehabilitated by operator hand.
Three structural causes, all verified in code:

1. **Rehabilitation runs too late.** `rehabilitateHaltPr` (undraft + unlabel +
   `Closes`-inject, warn-only, adr-2026-07-03 Decision 2) is wired only in the daemon
   post-run tail (`daemon-cli.ts:784-800`) — after `conductor.run()` returns, therefore
   after the finish gate has burned all its tries on the still-stale PR.
2. **The gate's presentation branch is untestable and incomplete.** It hardcodes
   `makeProductionGh()` (`artifacts.ts:1161`); zero tests reference `readStaleHaltTitle`
   (the #368 gap — PR #284 shipped the rehab path untested). It checks the title but not
   `isDraft` (#439 — features ship as drafts). `finish/SKILL.md:373` assigns the draft
   flip to the agent while `pr/SKILL.md:220-223` assigns it to the engine — a live
   contradiction.
3. **A recording-only miss costs a full re-walk.** When every gate condition holds
   except `finish-choice`/`pr_url`, the retry re-dispatches the entire ~10-minute finish
   skill instead of the one missing command.

Constraints from standing ADRs (both preserved, not amended):
- adr-2026-07-07: the agent-owned, fail-closed `finish-record` is the only writer of
  `finish-choice`/`pr_url`; the absent marker IS the refusal signal. Engine auto-record
  stays rejected.
- adr-2026-07-05: draft-alone is never a halt signal (#199 early-draft protection);
  halt classification stays title-prefix OR label; finish-time removal keeps
  verify-after-write (D5).

## Decision

Approach B (operator-selected 2026-07-11): split by facet — the engine owns presentation
mechanics deterministically; the agent keeps the ship/keep decision.

### D1 — Presentation repair moves in-step, order-gated pre-presentation (amends adr-2026-07-03 Decision 2; ordering revised by conflict-check 2026-07-11, operator-approved)

The `rehabilitateHaltPr` call relocates from the daemon post-run tail into the finish
step inside `conductor.run()`, invoked by the engine (not the agent) exactly once per
completion evaluation, **order-gated**: the completion predicate first verifies the
non-presentation conditions (fresh valid `finish-choice`, recorded `pr_url`, push
evidence); only when ALL of those hold does the engine run the repair, and only then are
the presentation conditions (title, isDraft) evaluated. Consequences of the ordering:

- A finish attempt that fails on recording or push evidence — including a refusal or a
  terminal halt — NEVER clears the `needs-remediation` label, body marker, or draft
  state, so the redispatch arm (label-based, adr-2026-07-05-needs-remediation-redispatch)
  and the reconciliation sweep (body-marker-based, adr-2026-07-05 D4) keep their signals
  on any non-shipping outcome.
- First-try ship is preserved: repair still runs strictly before the presentation checks
  that would otherwise fail the try.
- There is NO pre-dispatch invocation: the `/finish` agent's `/pr` rewrite operates on
  the PR as-is (today's behavior); mechanics are repaired after the agent, before the
  presentation checks.

The `daemon-cli.ts:784-800` tail call is removed (single invocation site; no dual-path
drift). Warn-only semantics, verify-after-write (adr-2026-07-05 D5), and the
sourceRef-gated `Closes` injection are unchanged — same function, new call site. A later
halt re-drafts via `ensureHaltPresentation`/reconciliation, which remain untouched.

### D2 — Deterministic retitle-floor (amends adr-2026-07-03 Decision 1)

When, at repair time, the recorded PR's title still starts with `needs-remediation:`,
the engine rewrites it to a functional floor derived from state:
`feat: <feature_desc>` (fallback: the branch name) — `feature_desc` and
`worktree_branch` are verified state fields (`types/state.ts:28,49`). The skill's `/pr`
prose rewrite remains the quality path and runs earlier in the attempt (during the agent
session), so the floor no-ops whenever the agent did its rewrite (prefix-gated). The
floor only fires — and its functional title ships, logged — when the agent dropped the
instruction; any later `/pr` pass improves it. Engine-authored prose stays
rejected; this is a floor, not the presentation. Body is NOT floor-rewritten (halt
banner removal stays with `/pr`; the body marker removal stays with
`cleanupHaltPresentation`).

### D3 — Gate hardening: injectable gh seam + isDraft check

The finish predicate's presentation branch takes an injected `GhRunner` (ctx-provided,
defaulting to production at the composition root) replacing the hardcoded
`makeProductionGh()` at `artifacts.ts:1161`, making the branch unit-testable with the
established `fakeGh` pattern (closes #368's seam gap). The same `gh pr view` read gains
`isDraft`: the gate fails while the recorded PR is still a draft (#439). This is a
**ship-readiness** check on the feature's own recorded PR — not halt classification —
so it does not conflict with adr-2026-07-05's draft-alone rule; the D1 repair readies
the recorded PR (any recorded PR at finish, including #199 early-draft ones, whose
finish-time ready-flip pr/SKILL.md already assigns to the engine) before the gate ever
reads it. Both title and draft checks stay fail-open on gh errors (presentation is not
worth blocking a ship — unchanged posture).

### D4 — Surgical recording-only retry

The finish predicate's result gains a machine-readable facet code alongside `reason`
(internal type extension of the completion-check result). When a completion miss is
recording-only (`finish-choice` absent/stale or `pr_url` missing) AND every other
condition already held, the engine's retry dispatches a narrow prompt naming exactly the
one `conduct-ts finish-record` command with the computed absolute `--pipeline-dir` —
not the full finish re-walk. The retry still counts against the step's bounded retry
budget; the refusal semantics of adr-2026-07-07 are intact because the surgical prompt
still ends in the same fail-closed CLI, which refuses when evidence is missing.

### D5 — SKILLs become documentation of engine behavior (#477 pattern)

`finish/SKILL.md` and `pr/SKILL.md` presentation items (undraft, unlabel, `Closes`,
draft flip) are rewritten as documentation of what the engine does, resolving the
`finish/SKILL.md:373` vs `pr/SKILL.md:220-223` contradiction in the engine's favor.
The prose title/body rewrite instruction remains an agent instruction (D2 floor is the
backstop). The `finish-record` exit contract stays an agent instruction
(adr-2026-07-07 Decision 5, unchanged).

## Consequences

- **Positive:** first-try finish success for every gate-detectable presentation gap;
  the manual-rehab class (#452/#444/#494) and draft-ship class (#439) close
  deterministically; the gate's presentation branch becomes testable (#368); one
  invocation site for rehab; recording-only misses drop from ~10 minutes to one narrow
  dispatch; SKILL/engine responsibility contradiction resolved.
- **Negative / trade-offs:** the finish step gains one bounded gh repair interaction
  per completion evaluation (idempotent, warn-only — a gh outage degrades to today's
  behavior); the retitle-floor can publish a functional (non-prose) title when the agent
  drops the rewrite (logged; `/pr` on any later pass improves it); relocating the rehab call
  changes daemon-cli's tail (covered by a new wiring test — the #368 lesson is that the
  pure function was tested but the wiring never was).
- **Testing obligations:** fakeGh-driven unit tests for the gate branch (stale title,
  isDraft, fail-open) and the order-gated repair (runs only after the non-presentation
  conditions pass; never on a refusing/failing attempt); a wiring test asserting the
  completion path invokes repair before the presentation checks and the daemon tail no
  longer does; a real-binary smoke for the surgical-retry prompt path (injected-runner
  lesson, PR #143).

## Alternatives Rejected

- **Full engine repair including evidence-gated auto-invocation of `finish-record`
  (filer's hypothesis, Approach A):** re-litigates adr-2026-07-07's explicit rejection —
  hollows the refusal signal; an agent that refuses for reasons beyond PR/push evidence
  (failing tests) would be whitewashed (#367 class).
- **Sharper retry prompts only (Approach C):** remains prompt discipline — the exact
  failure mode the intake documents; leaves rehab in the too-late tail; closes neither
  #368 nor #439.
- **Keeping the daemon-tail call alongside the in-step call:** two invocation sites for
  the same repair invite divergence and double-execution ambiguity; in-step subsumes the
  tail (it runs strictly earlier and on the same completing-finish scope).
- **Gate fail-closed on gh errors for the new isDraft check:** same rejection as
  adr-2026-07-03 — a gh outage must never block an otherwise-shipped feature.
