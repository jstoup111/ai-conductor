# Architecture Review: DECIDE-owned amendment of accepted `.docs/` artifacts

**Date:** 2026-08-04
**Tier:** M — lightweight review
**Refs:** jstoup111/ai-conductor#1293
**Decision:** `adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts.md` (APPROVED)
**Verdict:** APPROVED — proceed to stories

## What was reviewed

The proposal to make amendment of an accepted `.docs/` artifact a DECIDE-time act, performed in place
before BUILD entry, with mechanical rejection of any plan task that directs such an amendment, and a
non-blocking deferred-request route for mid-BUILD discovery.

## Feasibility

**Sound, and cheaper than it looks, because the load-bearing mechanism already exists.** The seal
baseline is created at first BUILD entry (`conductor.ts:4677`). Anything committed during DECIDE is
therefore *in* the baseline, not a deviation from it. The design needs no new tolerance, no new seal
schema, no rotation, and no reseal command — which is what decouples it from #1281.

The enforcement half reuses three existing, exported primitives rather than reimplementing any of
them: `parsePlanTaskPaths` (`plan-task-parse.ts:70`) for the task→paths map, the sealed directory list
(`protected-artifact-seal.ts:17-22`), and the own-feature stem predicate (`:508-511`). Reuse is not a
convenience here — it is what keeps the check correct when the definition of "sealed" next changes.

## Architectural alignment

**Deterministic where possible; LLM only where necessary — satisfied.** The check is set membership
over a path list. The ADR explicitly rejects an LLM judge for it. This is the repository's own Design
Principle applied at the point of the mistake.

**Provider-agnostic — satisfied, and materially so.** #1254 recorded a Codex BUILD session committing a
protected artifact through the write-guard that stops Claude, because that guard is wired through
`.claude/settings.local.json`, which Codex does not read. Every check in this design is engine-side.
A design that put enforcement in a host hook would have failed for exactly one provider, silently.

**Scope discipline — satisfied.** The ban is limited to the four sealed directories and to other
features' artifacts. Own-feature paths stay permitted because `remediation-append` writes remediation
tasks into the feature's own plan and depends on the #1047 self-amendment tolerance. A broader ban
would have broken shipped machinery.

## Concerns raised and resolved

**C1 — Does the new `.docs/amendments/` directory need to be sealed?**
No, and sealing it later would re-create this bug. It is the one write BUILD must be able to make when
it discovers a falsified assertion. Recorded as a consequence in the ADR so a future author does not
"tighten" it by reflex.

**C2 — Does the land gate make previously-merged plans un-buildable?**
No. Enforcement runs at plan authoring and at land, over the spec being landed. It is not retroactive
over merged plans. Verified against `land-spec.ts`'s existing gate ordering, which operates on the
idea's own artifact set.

**C3 — Does forbidding `plan` from tasking an amendment lose the work?**
No, because the amendment is already performed by the time `plan` runs. The ordering matters and is
load-bearing: `conflict-check` (which detects) runs at step index 99, `plan` at 109. The detector
already runs first. This is why the amendment act belongs in `conflict-check` and not in `plan`.

**C4 — What stops the mid-BUILD route becoming a silent escape hatch?**
The SHIP-side fail-closed condition. `finish` refuses to complete while an unresolved amendment-request
row is not carried into the PR body and filed as a follow-up. The build is never blocked; the *silence*
is. This is the distinction the intake drew, and the design honors it.

**C5 — Breadth across skills.** The reviewed change touches five skills plus `HARNESS.md`. That is
correct rather than excessive: the intent originates in three DECIDE skills independently, so a
single-skill fix would leave two paths that still produce a BUILD task for a sealed artifact.

## Required amendments to accepted artifacts

**None.** This change adds a rule and machinery; it falsifies no previously accepted assertion. No
existing story or ADR states that a plan task may name a sealed path — the plan skill is simply silent
on the question, and silence is not an accepted assertion. Checked against `skills/plan/SKILL.md`,
`skills/stories/SKILL.md`, `skills/conflict-check/SKILL.md`, and
`adr-2026-07-27-protected-artifact-seal-self-amendment-visibility`.

This review therefore records an empty ledger, which is itself the first exercise of the convention it
approves.

## Verify-Claims Verdict

Every claim above cites a line read directly during this review. No unconfirmed load-bearing
assumption remains.
