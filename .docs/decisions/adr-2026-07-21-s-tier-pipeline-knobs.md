# ADR: Small features are cheap through the existing pipeline's own knobs — no separate SDLC flow (#668)

**Date:** 2026-07-21
**Status:** APPROVED
**Approved-By:** jstoup111 (operator directive 2026-07-21 — "separate SDLC flows are wrong")
**Track:** technical · **Tier:** M · **Issue:** jstoup111/ai-conductor#668
**Supersedes:** PR #670 (closed — "lightweight DECIDE flow for size-S bugs"; a parallel flow, rejected)

## Context

Issue #668 is real: an S-tier bug that skips DECIDE with an ad-hoc hotfix worktree produces **no**
`.docs/` artifacts, so the daemon's autonomous-build gates have nothing to read and every
gate-satisfying field gets hand-stamped afterward — which failed three ways in one night
(owner-gate skip #656, DRAFT-ADR halt #662, un-Accepted stories #625). The filer's own hypotheses
(and closed PR #670) proposed a **separate, first-class lightweight DECIDE flow**: a new `size: S` +
`bug` trigger, a one-off `.docs/s-tier/<slug>.md` mini-spec artifact type, a bespoke
`landSTierSpec` primitive, an `expandMiniSpec` machinery, and a `resolveTierFromLabels` bypass —
a parallel authoring path sitting beside full DECIDE.

**The operator has rejected that shape.** A parallel flow is a second SDLC to test, gate, and keep
in sync — a permanent divergence surface (the very "one path shipped, five parked" class the harness
keeps re-learning). The pain in #668 is not "we lack a small-work flow." It is that the *bypass*
skipped DECIDE and therefore skipped the machinery that stamps Owner / `Status: Accepted` / APPROVED
ADR by construction. The correct fix is to make running the **existing** pipeline cheap enough that
there is no incentive to bypass it — because the pipeline **already** right-sizes small work; it was
simply never tuned to be cheap end-to-end.

### What the existing pipeline already does for Small (verified anchors)

- **Step/artifact skips are already tier-gated.** `steps.ts` marks `architecture_diagram`
  (`steps.ts:69`), `architecture_review` (`steps.ts:82`), `conflict_check` (`steps.ts:104`),
  `acceptance_specs` (`steps.ts:125`), `architecture_review_as_built` (`steps.ts:219`) and `retro`
  (`steps.ts:233`) with `skippableForTiers: ['S']`. The conductor applies them at
  `conductor.ts:1908`, emitting a `tier_skip` event. So Small already authors no architecture doc,
  no ADR, no conflict-check, and skips the as-built sweep — the exact ceremony #668 says S over-pays.
- **Per-step tier overrides already exist.** `DEFAULT_STEP_TIER_OVERRIDES` (`resolved-config.ts:144-158`)
  already carries `stories.S = { effort: 'low' }` and `plan.S = { effort: 'medium', max_retries: 3 }`.
  The resolver applies them via the `hardcodedStepTier` rung of the precedence chain
  (`resolved-config.ts:234-236`, consumed at `:245`, `:256`, `:266`), and the conductor threads the
  live tier in at `conductor.ts:1975-1977`.
- **Retry-as-escalation is already the recovery mechanism.** `escalateAttempt`
  (`escalation.ts:76-93`) bumps effort (attempt 2) then model tier (attempt 3+) on the base config,
  default-on via `DEFAULT_STEP_ESCALATE` (`resolved-config.ts:170`). #188
  (`adr-2026-07-05-retry-as-escalation-ladder`) deliberately floored deep-step budgets at **3** so the
  model-bump rung at attempt 3 stays reachable.
- **The evidence tail is tier-invariant.** `build` (`steps.ts:130`), `build_review` (`steps.ts:145`),
  `wiring_check` (`steps.ts:159`), `manual_test` (`steps.ts:169`), `rebase` (`steps.ts:243`) and
  `finish` (`steps.ts:253`) carry **no** `skippableForTiers` — they run for every tier. Smallness can
  never reach them.

So the only missing piece is: express "this is small" as a **lean resolution profile of the same
steps** (cheaper base model/effort, tighter retry budgets on the steps S still runs) — not a new flow.

## Decision

Small work stays on the **one** pipeline. "Smallness" is expressed **entirely** through the
pipeline's existing resolution knobs. No new step types, no new artifact type, no new land primitive,
no parallel flow. Six decisions:

### D1 — Extend the existing `DEFAULT_STEP_TIER_OVERRIDES` table with an S profile (no new mechanism)
Add `S` rows for the DECIDE/BUILD steps S still runs, using the **same** `TierOverride` shape and the
**same** resolver rung already in production (`resolved-config.ts:234-236`):

- `explore.S = { effort: 'low' }` — an S bug's discovery is a narrow root-cause anchor, not a
  high-fan-out ideation; base effort drops from `medium` (`DEFAULT_STEP_EFFORT.explore`,
  `resolved-config.ts:59`).
- `stories.S` — **unchanged** (already `{ effort: 'low' }`).
- `plan.S` — **unchanged** (already `{ effort: 'medium', max_retries: 3 }`).
- `build.S = { max_retries: 3 }` — leave `build`'s base model (`sonnet`) and effort (`low`) as-is
  (real coding still needs Sonnet, `model-table-metadata.ts:33`) but keep the budget at the #188
  floor of 3 so the escalation ladder's model rung remains reachable for a misjudged S.

No new field, no new code path — only new rows in a table the resolver already reads. `M`/`L`
behavior is untouched (those keys are absent from the S rows).

### D2 — Smaller retry budgets for S, floored at 3 (reconciles with #188)
Where an S row sets `max_retries`, it never goes below **3**. This is not an independent choice — it
is #188 Decision 4 (`adr-2026-07-05-retry-as-escalation-ladder`, "floor at 3 so the model-bump rung
at attempt 3 is reachable"). A budget of 2 would truncate the ladder before it ever upgrades the
model — precisely the failure #188 forbids. Cheaper-for-S means **lower base effort**, not fewer
than 3 attempts.

### D3 — Lower base, ladder as the safety net (this is the S risk story)
An S resolution is a *hypothesis that the work is small*. If it is wrong, the step fails its gate and
`escalateAttempt` (`escalation.ts:76`) climbs: attempt 2 raises effort off the low S base, attempt 3+
upgrades the model tier — the identical recovery every other tier gets. Because base is low and the
ladder is default-on (`resolved-config.ts:277-281`), a correctly-judged S is cheap and a
mis-judged S self-heals up to its (≥3) budget before halting. **Smallness lowers the floor; it never
removes the safety net.**

### D4 — No evidence gate is tier-weakened (the hard invariant)
The S profile touches **only** `model`/`effort`/`max_retries` on DECIDE/BUILD-authoring steps. It
adds **nothing** to any `skippableForTiers` list and disables no gate. `build_review`,
`wiring_check`, `manual_test`, `rebase`, `finish` run for S exactly as for L (`steps.ts:145-262`,
none tier-skippable). RED-first, the SHIP tail, and the finish gate are identical across tiers. A
test pins the tier-invariant gate set so a future edit can't quietly tier-skip a gate.

### D5 — Optional: label-authoritative tier seeds the *same* complexity artifact (deterministic, no bypass)
`size: S` may seed `Tier: S` deterministically **into the same `.docs/complexity/<slug>.md` the
existing reader already consumes** (`parseComplexityTier`, `artifacts.ts:1902`), short-circuiting only
the LLM signal walk (`assessTier`, `complexity.ts:30-50`) — not the pipeline. This is a convenience on
the DECIDE **complexity** step, not a trigger for a new flow: the tier the conductor threads at
`conductor.ts:1905` / `:1976` is unchanged in kind; only its *source* (a label vs an LLM walk) differs.
It is **secondary** to D1-D4 and can ship separately; the knob tuning stands on its own.

### D6 — #668's gate failures die because the bypass dies, not by new machinery
Once running the pipeline is cheap, the S bug goes through the **real** engineer DECIDE, so:
the intake Owner marker is written by the normal `land --source-ref` path (SKILL.md step 4);
stories end `Status: Accepted` via the real `/stories` skill; and S **authors no ADR at all**
(`architecture_review` is S-skipped, `steps.ts:82`), so a DRAFT ADR is impossible. #656/#662/#625
become unreachable for S work **without** a single new gate reader or `expandMiniSpec` — the opposite
of PR #670's "satisfy the gates by construction with new machinery." We satisfy them by *not skipping
the machinery that already satisfies them*.

## Consequences

- **Positive:** one pipeline, one gate set, one place to reason about cost. Small work is cheap via a
  handful of table rows the resolver already interprets — near-zero new surface, no divergence to
  keep in sync, no `size: S`/`bug` trigger to test.
- **Positive:** #668's pain is resolved by removing the bypass incentive; #656/#662/#625 cannot recur
  for S because DECIDE (which stamps them) runs.
- **Negative / watch:** a genuinely under-tiered S pays a retry or two climbing the ladder before it
  either succeeds or (mid-flight, since `conductor.ts:1905` re-reads `complexity_tier` each iteration)
  is re-tiered up. Accepted: the ladder is the designed recovery and no gate is weakened, so the worst
  case is *slower*, never *corrupt*.
- **Negative / watch:** lowering `explore.S` / keeping tight S budgets shifts S's cost/quality profile;
  bounded by the ≥3 floor (D2) and asserted by negative-path tests (D3/D4).

## Alternatives considered

- **A separate lightweight DECIDE flow (PR #670).** Rejected by operator directive: a parallel SDLC
  is a permanent second path to gate and sync; it "satisfies gates by construction" only by adding a
  mini-spec type, an expander, and a land branch — new surface to protect the very gates the existing
  flow already satisfies when not bypassed.
- **A new `size: S` build-time skip list.** Rejected — that would weaken the evidence tail (violates
  D4). Small already skips the right things (authoring ceremony) via `skippableForTiers: ['S']`; the
  gap was cost tuning, not more skipping.
- **Cut S retry budgets to 1-2.** Rejected — breaks the #188 model-bump rung (D2).
