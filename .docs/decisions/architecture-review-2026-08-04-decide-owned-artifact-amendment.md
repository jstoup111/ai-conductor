# Architecture Review: DECIDE-owned mutation of accepted `.docs/` artifacts

**Date:** 2026-08-04
**Tier:** M — lightweight review
**Refs:** jstoup111/ai-conductor#1293
**Decision:** `adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts.md` (APPROVED)
**Verdict:** APPROVED — proceed to stories

## What was reviewed

The proposal that DECIDE performs the mutation of an accepted `.docs/` artifact in place, before BUILD
entry, and that no skill may emit a task directing such a mutation — with deterministic rejection at
plan authoring and again at land, and a BUILD-discovered falsification routed back to DECIDE.

An earlier draft added a BUILD-writable request artifact so a mid-BUILD discovery need not return to
DECIDE. That draft was rejected by the operator and is recorded in the ADR's §5 with the reasoning.
This review covers the revised design only.

## Feasibility

**Sound, and cheaper than it looks, because the load-bearing mechanism already exists.** The seal
baseline is created at first BUILD entry (`conductor.ts:4677`). Anything committed during DECIDE is
therefore *in* the baseline, not a deviation from it. The design needs no new tolerance, no new seal
schema, no rotation, and no reseal command — which is what decouples it from #1281.

The enforcement half reuses three existing exported primitives rather than reimplementing any:
`parsePlanTaskPaths` (`plan-task-parse.ts:70`) for the task→paths map, the sealed directory list
(`protected-artifact-seal.ts:17-22`), and the own-feature stem predicate (`:508-511`). Reuse is not a
convenience here — it is what keeps the check correct when the definition of "sealed" next changes.

## Architectural alignment

**Deterministic where possible; LLM only where necessary — satisfied.** The check is set membership
over a path list, and the ADR explicitly rejects an LLM judge for it.

**Provider-agnostic — satisfied, and materially so.** #1254 recorded a Codex BUILD session committing a
protected artifact through the write-guard that stops Claude, because that guard is wired through
`.claude/settings.local.json`, which Codex does not read. Every check here is engine-side. A design
placing enforcement in a host hook would have failed for exactly one provider, silently.

**Phase ownership — satisfied, and this is the review's central finding.** The revised design keeps
every DECIDE-scope mutation inside DECIDE. The rejected draft did not: it let BUILD record a
DECIDE-owned decision elsewhere so it need not return. Reviewed against the issue's actual goal, that
is the same defect the issue reports, relocated rather than fixed. The revision is not a scope
reduction; it is the difference between solving the problem and routing around it.

**Scope discipline — satisfied.** The ban is limited to the four sealed directories and to other
features' artifacts. Own-feature paths stay permitted because `remediation-append` writes remediation
tasks into the feature's own plan and depends on the #1047 self-amendment tolerance.

## Concerns raised and resolved

**C1 — Does forbidding `plan` from tasking a mutation lose the work?**
No, because the mutation is already performed by the time `plan` runs. The ordering is load-bearing and
was verified: `conflict_check` sits at `steps.ts:99`, `plan` at `:109`. The detector already runs
first, which is why the mutation act belongs in `conflict-check` and not in `plan`.

**C2 — Does the land gate make previously-merged plans un-buildable?**
No. Enforcement runs at plan authoring and at land, over the spec being landed. It is not retroactive.
Verified against `land-spec.ts`'s existing gate sequence, which operates on the idea's own artifact set.

**C3 — Does routing a mid-BUILD discovery to DECIDE strand features on an operator gate?**
It can, and that is accepted rather than engineered around. Two things bound the cost: `conflict-check`
now acts at DECIDE time, so the mid-BUILD case is the residue after the detector has run; and the gate
reached is the *existing* one (`kickback-policy.ts:7-23`), so this change adds no new stall mode. The
alternative — a BUILD-side bypass — trades a rare human gate for a permanent hole in phase ownership.

**C4 — What is the fail-closed guarantee, with no new SHIP gate?**
The seal's existing halt. If DECIDE fails to amend and BUILD edits the artifact, the seal halts and
names the path. The intake's "fails closed and says so" requirement is already met by shipped
machinery; what was missing was a sanctioned way to satisfy it, which is the DECIDE mutation act.
Verified that TS-4 pins the halt as unchanged.

**C5 — Breadth across skills.** The change touches five skills plus `HARNESS.md`. Correct rather than
excessive: the intent originates in three DECIDE skills independently, so a single-skill fix would
leave two paths that still produce a BUILD task for a sealed artifact.

## Required amendments to accepted artifacts

**None.** This change adds a rule and machinery; it falsifies no previously accepted assertion. No
existing story or ADR states that a plan task may name a sealed path — `skills/plan/SKILL.md` is simply
silent, and silence is not an accepted assertion. Checked against `skills/plan/SKILL.md`,
`skills/stories/SKILL.md`, `skills/conflict-check/SKILL.md`, `skills/remediate/SKILL.md`, and
`adr-2026-07-27-protected-artifact-seal-self-amendment-visibility`.

## Verify-Claims Verdict

Every claim above cites a line read directly during this review. No unconfirmed load-bearing
assumption remains.
