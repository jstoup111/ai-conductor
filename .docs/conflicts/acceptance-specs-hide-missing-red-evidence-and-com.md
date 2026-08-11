# Conflict Check: Acceptance-specs RED evidence visibility (#1246)

**Date:** 2026-08-09
**Stories checked:** `.docs/stories/acceptance-specs-hide-missing-red-evidence-and-com.md`
(Stories 1-7) against each other and against the accepted corpus on the same seam —
`acceptance-specs-red-evidence.md` (#741), `writing-system-tests-red-exit-gate.md` (#297),
`writing-system-tests-fr-coverage.md`, `full-suite-verification-gate-940.md`,
`adr-2026-07-21-engine-owned-acceptance-red-execution`, and
`.docs/plans/acceptance-specs-halts-when-the-red-evidence-marke.md`.
**Result:** 2 blocking structural gaps, 0 degrading conflicts. Both rooted in the design, not in
story phrasing — routed to architecture in amendment mode and resolved below.

---

## Conflict 1: The self-heal guard cannot see a semantically invalid marker

**Stories involved:** Story 7 (recovery by re-run) vs the shipped self-heal guard
**Files:** `.docs/stories/acceptance-specs-hide-missing-red-evidence-and-com.md` vs
`src/conductor/src/engine/conductor.ts:5326-5333`
**Type:** state-conflict (a design assumption the seam does not satisfy)
**Severity:** blocking
**Confidence:** 99% — verified by direct read of both the guard and every reason branch it matches
against.

### Description

Story 7 and `adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance` both assume that a
legacy counters-only marker, once the validator tightens, reads as "invalid" and therefore reaches
the existing self-heal. The guard does not work that way. It is a **substring match on the
completion reason**, not a check on validity:

```ts
const namesMissingOrInvalidRedMarker =
  !preCheck.done &&
  typeof preCheck.reason === 'string' &&
  (preCheck.reason.includes(`${marker} is missing`) ||
   preCheck.reason.includes(`invalid JSON in ${marker}`));
```

The `acceptance_specs` predicate produces exactly three failure shapes
(`artifacts.ts:2018-2043`):

| Predicate branch | Reason text | Matches the guard? |
|---|---|---|
| File absent | `… is missing — the writing-system-tests skill must run …` | yes |
| Unparseable JSON | `invalid JSON in …` | yes |
| `validateAcceptanceRedEvidence` refuses | the validator's own reason | **no** |

A legacy marker is valid JSON that the *validator* refuses — the third branch. It matches neither
substring, so the self-heal never fires. The step instead falls into the ordinary retry loop and
re-dispatches `/writing-system-tests` in print mode, which is precisely the ~15s no-op failure mode
`adr-2026-07-21` was written to escape, ending in a HALT at the retry cap.

The approved back-compat decision is therefore not implementable as written. This is the exact risk
Condition 1 of the architecture review flagged for verification; the verification came back
negative.

### Resolution Options

1. **Widen the guard to fire on validator refusals that a re-run could fix** — shape defects
   (missing/empty provenance fields, missing `command`/`targetSpecs`, non-numeric counters) — while
   continuing NOT to fire on verdicts that report a real observed outcome (`0 failed`, `skipped > 0`,
   `errors > 0`), since re-running cannot change those and would burn a spec run per attempt to
   re-learn the same result.
2. Widen the guard to fire on **every** validator refusal. Simpler, but re-runs a green suite on
   every attempt to rediscover that it is green.
3. Abandon re-run and grandfather legacy markers. Already rejected with reasons in the ADR.

**Recommendation: Option 1.** It is the only option that makes the approved decision work without
paying for runs whose outcome is already known. Condition 1 of the review pre-authorizes widening
the guard as the correct fix, and explicitly forbids retreating to grandfathering.

### Resolution applied

Option 1. `adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance` amended additively;
Story 8 added to carry the guard change and its negative paths.

---

## Conflict 2: A self-heal run destroys a recorded remediation exception

**Stories involved:** Story 5 (recorded exception) vs Story 2 / Story 7 (self-heal writes the marker)
**Files:** `.docs/stories/acceptance-specs-hide-missing-red-evidence-and-com.md` vs
`src/conductor/src/engine/acceptance-red-runner.ts:249-258`
**Type:** resource-contention (two writers, one artifact, last write wins)
**Severity:** blocking
**Confidence:** 95% — verified by direct read of the marker-write in `selfHealAcceptanceRed`.

### Description

`selfHealAcceptanceRed` composes the marker from the exec result plus the contract and writes it
**wholesale**:

```ts
const markerContent = {
  ...(typeof execResult === 'object' && execResult !== null ? execResult : {}),
  command: contract.command,
  targetSpecs: contract.targetSpecs,
};
writeRedMarkerAtRoot(resolvedRoot, markerContent);
```

Every field not produced by the exec result is dropped. Under Story 5 the exception is a marker
field, so any self-heal that fires after a remediation recorded one silently erases it. The step
then refuses a run the operator legitimately waived, with a reason that describes a missing RED
signal rather than a destroyed waiver — the failure is not merely wrong, it is misdescribed.

This was not visible at architecture time because, before this feature, nothing in the marker was
authored by anyone other than the run itself. Adding the first *declaration* field to a
result-shaped artifact is what creates the contention.

Note the bidirectional test both ways: fully satisfying Story 5 (the exception governs the verdict)
breaks Story 2/7 (self-heal owns the marker); fully satisfying Story 2/7 breaks Story 5. Two "no"
answers — this is an oscillation, not a one-sided overlap, and no amount of implementation care
resolves it without changing what is asked for.

### Resolution Options

1. **Self-heal preserves declaration fields it did not produce.** Before writing, read any existing
   root marker and carry forward its `exception` — the exec result governs the counters, the prior
   declaration governs the waiver. The authoritative-root-path rule of `adr-2026-07-21` is untouched.
2. Move the exception out of the marker into its own artifact. Rejected: a second file for gate
   state the marker already carries is the parallel-channel trap the event-spine skill exists to
   prevent, and it splits one verdict across two reads.
3. Forbid self-heal from running when an exception is present. Rejected: it makes a waived step
   unrecoverable from a missing marker, trading one silent failure for another.

**Recommendation: Option 1.** It keeps one artifact, one authoritative path, and one verdict, and
it makes the two writers' ownership explicit rather than incidental: **the exec result owns observed
counters; a recorded declaration survives re-execution.**

### Resolution applied

Option 1. Both ADRs amended additively; Story 8 carries the preservation behavior and its negative
paths.

---

## Adjudicated hazards — no conflict found

**Oscillation on unextractable provenance (hazard 2). Clean.** If the self-heal runs and cannot
extract per-test identity, `selfHealAcceptanceRed` returns `healed: false` with a reason and the
step falls through into the ordinary retry loop (`conductor.ts:5356`, `if (!acceptanceRedPreHealed)`).
The pre-heal block sits **before** `while (attempt < stepMaxRetries)`, so it executes at most once
per step run, not once per attempt. The path terminates at the retry cap with a HALT. No loop.

**Exception vs the unchanged refusal text (hazard 3). Jointly satisfiable.** Story 4 governs the
no-exception case and Story 5 the exception case; they are disjoint on the presence of a well-formed
exception, so both hold simultaneously. One accepted assertion is narrowed by this — see Amendments.

**`events.ts` contention (hazard 4). Degrading, accepted, no sequencing needed.** 242 open spec
branches touch `src/conductor/src/types/events.ts` and none touch the other five surfaces. Every one
of those branches is an *additive* union extension, so the collision is textual, not semantic:
appending the `acceptance_red` variant at the end of the union (review Condition 3) reduces the
conflict surface to one adjacent line, which `git` resolves or a human resolves in seconds. Nothing
in the plan needs to sequence around it.

**Superseded #297 clause not resurrected. Clean.** `writing-system-tests-red-exit-gate.md` (#297)
had its "fix the skill, not an engine workaround" clause superseded by `adr-2026-07-21`. Stories 1-8
extend the engine mechanism and treat the skill's own recording as the best-effort happy path,
exactly as that ADR retained it. No story asks for the skill exit gate to become the authoritative
guarantee.

**Out-of-scope boundary leaves no story unsatisfiable (hazard 6). Clean.** Story 6 is the only story
touching the deferred telemetry, and its Done When requires the child-count field to render the
literal `unknown` and asserts no path can render `0`. That is satisfiable with zero subagent
observation — it is a requirement *about the absence*, not a requirement that depends on the absent
data. No other story's Done When references child count or token consumption.

---

## Amendments to accepted artifacts

Applied in this DECIDE pass, additively, per the amendment convention:

1. `.docs/stories/acceptance-specs-red-evidence.md` (#741), the assertion that an engine-executed
   contract showing `failed == 0` always fails the gate — narrowed by the recorded-exception design.
2. `.docs/decisions/adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance.md` — the
   back-compat mechanism now names the guard widening it depends on.
3. `.docs/decisions/adr-2026-08-09-recorded-red-exception-for-remediation.md` — the exception's
   survival across a self-heal re-execution is now stated as part of the decision.

Story 8 was added to `.docs/stories/acceptance-specs-hide-missing-red-evidence-and-com.md` to carry
both resolutions with their negative paths.

---

## Re-check

Re-run after amendments: **passed clean.** Zero blocking conflicts remain. One degrading condition
is accepted and recorded: textual rebase contention on `src/conductor/src/types/events.ts`,
mitigated by appending at the end of the union.
