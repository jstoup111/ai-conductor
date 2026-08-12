# Coherence Mapping: Unhalt after main advance resumes against stale feature base

**Date:** 2026-08-11
**Issue:** jstoup111/ai-conductor#1245
**Stem:** `unhalt-after-main-advance-resumes-against-stale-fe`
**Track:** technical · **Tier:** M
**Verdict:** all rows `covered` — zero gaps, zero contradictions.

Requirements are the intake issue's Desired-outcome bullets (`Outcome-1` … `Outcome-5`). There is
no PRD on the technical track, so the `fr` row class is omitted as not applicable rather than
recorded as a gap. The `outcome` row class is likewise omitted: no outcomes file is staged or
committed for this slug at gate time (the `.docs/intake/` marker is written by land itself), and an
absent outcome layer is "not required" rather than a gap. Outcome coverage is recorded in prose
below and is carried mechanically by each story's `**Requirement:**` line, which the stories file
declares directly.

## Outcome coverage

Every Desired-outcome bullet is cited by at least one story, verified against the stories file's
`**Requirement:**` lines:

- **Outcome-1** (evaluate the advanced base before dispatching) — story-1, story-2, story-4,
  story-5, story-9, story-10. story-2 pins the ordering; story-1 supplies the verdict it acts on.
- **Outcome-2** (an already-equivalent patch is not feature-owned scope) — story-6, story-10.
- **Outcome-3** (never ask a build agent to reverse or re-plan main-owned work) — story-2, story-6,
  story-8, story-10.
- **Outcome-4** (seal follows the audited rebaseline, no manual reseal) — story-7.
- **Outcome-5** (unchanged base forces no rebase, evidence survives) — story-1, story-3.

## Mapping

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| story | story-1 | task-1, task-2, task-3, task-4 | covered | Three-valued verdict type plus one task per verdict; task-4 covers all four `undeterminable` triggers. |
| story | story-2 | task-8, task-9, task-12 | covered | task-8 derives the halt-resume signal, task-9 wires the seam, task-12 asserts a non-halt-resume dispatch evaluates nothing. |
| story | story-3 | task-10, task-11 | covered | task-10 pins evidence-identical resume on `current`; task-11 pins no-rebase on `undeterminable` while a co-present sentinel still plays forward. |
| story | story-4 | task-5, task-6, task-7 | covered | task-5 covers all four guard combinations including single sentinel consumption on "both". |
| story | story-5 | task-13 | covered | Park precedence at the new seam, including the fail-toward-parked throwing-check path. |
| story | story-6 | task-17 | covered | Acceptance test on a real local repo, with the without-rebase control and the same-files-different-patch survival case. |
| story | story-7 | task-18 | covered | Verify-only task; asserts rotation lineage and the `noop`/`conflict_halt` exclusion. Story carries a 2026-08-11 amendment reframing it as verification of inherited behavior. |
| story | story-8 | task-14, task-16 | covered | task-14 covers trigger attribution in the HALT reason; task-16 covers the self-limiting second resume. |
| story | story-9 | task-15 | covered | Union variant plus the compile-enforced `EVENT_SINKS` entry. |
| story | story-10 | task-19 | covered | End-to-end reproduction of the reported incident. |
| task | task-1 | story-1 | covered | Infrastructure task; cites a real story rather than relying on the supporting-purpose exemption. |
| task | task-2 | story-1 | covered | `current` verdict happy path. |
| task | task-3 | story-1 | covered | `advanced` verdict happy path. |
| task | task-4 | story-1 | covered | Four `undeterminable` triggers, each its own case. |
| task | task-5 | story-4 | covered | Explicit trigger option and the two-condition guard. |
| task | task-6 | story-4 | covered | One-shot contract on the failure path. |
| task | task-7 | story-4 | covered | Unreadable sentinel does not abort a triggered resume. |
| task | task-8 | story-2 | covered | Infrastructure task; halt-resume signal derivation. |
| task | task-9 | story-2 | covered | The single wiring point; converges the three independent tracks. |
| task | task-10 | story-3 | covered | Gate verdicts byte-identical after a `current` resume. |
| task | task-11 | story-3 | covered | Suppression scoped to the new trigger only. |
| task | task-12 | story-2 | covered | Fresh dispatch issues no evaluation git commands. |
| task | task-13 | story-5 | covered | Park precedence regression. |
| task | task-14 | story-8 | covered | Conflict HALT trigger attribution; no new halt class. |
| task | task-15 | story-9 | covered | Event variant, sink entry, emission at the seam. |
| task | task-16 | story-8 | covered | Second resume at an unchanged base grants no fresh kickback budget. |
| task | task-17 | story-6 | covered | Regression proof with control. |
| task | task-18 | story-7 | covered | Verify-only; seal lineage assertions. |
| task | task-19 | story-10 | covered | Incident scenario reaches BUILD. |
| adr | adr-2026-08-11-resume-time-base-advance-evaluation | story-1, story-2, story-3, story-9 | covered | Decides the seam, the three-valued predicate, the `undeterminable` fail-toward-today rule, and spine-based observability. Each is implemented by a cited story. |
| adr | adr-2026-08-11-play-forward-entry-trigger | story-4, story-5 | covered | Decides the explicit trigger at the call site with sentinel semantics preserved (story-4) and park precedence unchanged (story-5). Its accepted daemon-stopped gap is deliberately unimplemented and correctly has no story. |
| adr | adr-2026-07-07-build-review-judgement-gate | story-2, story-6 | covered | Modified in this change set. Its diff-stability parenthetical was falsified by the mid-BUILD rebase these stories introduce; resolved by an additive 2026-08-11 amendment in the same diff, so the artifact as it now stands does not contradict them. See Consistency Pass. |

## Condition traceability

The architecture review returned APPROVED WITH CONDITIONS. All six are discharged:

1. **Regression proof with control** — story-6 → task-17. Both halves present: the commit is absent
   from the graded range after the rebase, and the suppressed-rebase control still fails Scope.
2. **`undeterminable` coverage asserting no rebase** — story-1 → task-4 (verdict derivation, all
   four triggers) and story-3 → task-11 (no rebase at the dispatch seam).
3. **All four guard combinations** — story-4 → task-5, including "both" consuming the sentinel
   exactly once.
4. **Park precedence regression test** — story-5 → task-13.
5. **No manual reseal, asserted against `rebaselines[]` lineage** — story-7 → task-18. The story's
   Done When explicitly rejects "absence of a HALT" as sufficient.
6. **Conflict HALT names its trigger** — story-8 → task-14.

## Consistency pass

Cross-layer pairs were checked in both directions per §4d. Three were worth reasoning through:

**outcome-1 ↔ outcome-5** — the pair most likely to oscillate: "always evaluate the advanced base"
against "never force an unnecessary rebase." Satisfying outcome-1 fully does not break outcome-5,
because evaluation is not rebasing — the `current` verdict dispatches untouched. Satisfying
outcome-5 fully does not break outcome-1, because the evaluation still runs and simply finds
nothing to integrate. The three-valued verdict is precisely what keeps these independent; a boolean
"is it stale?" would have collapsed them into a genuine oscillation. Not a contradiction.

**outcome-2 ↔ story-6 negative path** — "drop the upstream-equivalent commit" against "a
same-files-but-different-patch commit must survive the rebase." Both hold simultaneously because
patch-equivalence is exact, not path-based. Not a contradiction.

**outcome-4 ↔ story-7 amended negative path** — "rotate the seal" against "`noop` and
`conflict_halt` leave the seal untouched." These are disjoint outcomes of the same call, not
competing rules: rotation is reached only on a clean rebase that moved HEAD. Not a contradiction.

**adr-2026-07-07-build-review-judgement-gate ↔ story-2, story-6** — the one real finding. That
ADR asserted the graded diff is *"stable during BUILD since the only sanctioned rebase is
finish-time"*, which these stories falsify by rebasing at halt-resume. The assertion was already
false before this feature (the re-kick play-forward rebases pre-loop on the sentinel path), so this
spec widens the frequency rather than introducing the class. Resolved during this DECIDE pass by an
additive amendment beside the original assertion, in the same diff, per
`adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts`. The row is therefore `covered` and
not `fail`: as the artifact now stands it no longer opposes the stories. Recorded here so the
verdict is auditable rather than silent.

## Scope note

The intake issue carries a sixth desired-outcome bullet — a park request racing an in-flight step
must not silently leave a newly written HALT outside the requested recovery path. It is **out of
scope by operator decision** and is being split to its own intake issue, so it is deliberately not
mapped above. Its absence is a scoping decision, not an uncovered outcome; no `outcome-6` row is
authored because no such requirement is in this spec's change set.

Documentation is likewise unmapped by design: this repository owns a gating
`maintain-documentation` custom step (`.ai-conductor/config.yml`) that runs after `rebase` in the
same PR, so documentation is not plan-task work here.
