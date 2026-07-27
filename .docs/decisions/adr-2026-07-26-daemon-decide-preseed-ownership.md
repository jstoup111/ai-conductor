# ADR: DECIDE-phase steps are preseeded by derivation, and vetted at discovery

**Date:** 2026-07-26
**Status:** APPROVED
**Feature:** 2026-07-26-daemon-decide-phase-coherence-ownership-971 (fix #971)
**Related:** `.docs/architecture/2026-07-26-daemon-decide-phase-coherence-ownership-971.md`,
`.docs/track/2026-07-26-daemon-decide-phase-coherence-ownership-971.md`

## Context

`coherence_check` is declared `phase: 'DECIDE'` (`steps.ts:119-131`) but is the only one of the
nine DECIDE steps absent from the daemon's hand-maintained `PRESEEDED_DONE` constant
(`daemon-cli.ts:285-296`). The daemon therefore resumes a fresh build directly onto a DECIDE
authoring step. This is production-observed, not theoretical: eight features recorded
`coherence_check` executing under the daemon, and one M-tier run exhausted its retry budget on a
provider rate limit and **halted the whole build** (`daemon.log:7906-7911`).

Three properties of the current design make this more than a missing list entry:

- The constant is hand-maintained with **no** test asserting it stays in sync with `steps.ts`.
  The one integration test that references it keeps a hand-copied duplicate
  (`audit-trail-daemon-wiring.integration.test.ts:62`) that is never compared to the real
  constant, so drift is undetectable in both directions.
- Simply adding the missing name converts "the daemon authors the artifact" into "nobody checks
  the artifact" for any spec that reached the default branch without passing
  `conduct-ts engineer land` — a regression against the issue's third desired outcome.
- The three other tier-skippable DECIDE steps are stamped `'done'` unconditionally, so preseeding
  a fourth one inherits an existing semantic inconsistency about S-tier specs.
- The engine-owned `runAuthoring` seam has its own canonical DECIDE sequence. Before this
  change it stopped at `plan`, so an engineer-authored M/L spec could reach its spec branch
  without the coherence artifact the daemon now requires. The authoring path must close that
  gap rather than relying on an operator to invoke a separate step by convention.

This repo's Design Principle is explicit that the durable fix for a repeatedly-violated
invariant is machinery, not a corrected instance.

## Decision

### D1 — `PRESEEDED_DONE` is derived from the step table, not hand-maintained

The daemon computes its preseed set as the two explicitly-named non-DECIDE members plus every
step whose declared phase is `DECIDE`:

```
['worktree', 'memory', ...ALL_STEPS.filter(s => s.phase === 'DECIDE').map(s => s.name)]
```

`ALL_STEPS` is already exported (`steps.ts:4`) and `StepDefinition` already carries `phase`
(`types/steps.ts:50-56`), so no new plumbing is required. `worktree` (`phase: 'SETUP'`) and
`memory` (`phase: 'UNDERSTAND'`) remain literals because they are genuinely not DECIDE steps and
their inclusion is a separate, intentional decision.

**Phase membership is hereby the contract governing daemon preseeding.** A step declared
`phase: 'DECIDE'` is owned by DECIDE and is never executed by the daemon. A future step that
needs daemon execution must not be declared `phase: 'DECIDE'`.

*Rejected alternative — a new `preseededForDaemon?: boolean` flag on `StepDefinition`.* It is
more explicit per step, but it is itself a field that can be forgotten on a new step, which
reproduces exactly the omission being fixed. Deriving from `phase` has no per-step maintenance
obligation and fails safe: forgetting to think about preseeding yields the correct result.

### D2 — A preseeded step is stamped with a tier-correct status

When the daemon preseeds, a step that is skippable for the run's resolved tier is stamped
`'skipped'`; otherwise it is stamped `'done'`.

Stamping `'done'` asserts that an artifact was produced. For an S-tier spec, the coherence
artifact legitimately does not exist, so `'done'` is a false statement recorded in durable
state, and it erases the `tier_skip` distinction the conductor currently computes at
`conductor.ts:2549-2557`. The issue's fourth desired outcome requires tier applicability to stay
"explicit and testable"; a status that cannot distinguish "skipped because S" from "authored"
does not meet that bar.

This corrects the same latent inconsistency for `architecture_diagram`,
`architecture_review`, and `conflict_check`, which are stamped `'done'` unconditionally today.
That correction is in scope: it is the same one-line stamping decision, and leaving three steps
wrong while fixing a fourth would leave the invariant untestable.

*Rejected alternative — stamp `'done'` uniformly and accept the imprecision.* Cheaper, but it
makes outcome 4 unverifiable and preserves a durable falsehood in `conduct-state.json`.

### D3 — A missing or invalid required coherence artifact is rejected at daemon discovery

The discovery vetting loop (`daemon-backlog.ts:655-673`) gains a third check: when the resolved
tier is not `S`, the merged spec must carry a `.docs/coherence/<slug>.md` that is present,
non-empty, and parseable as a coherence table with at least one data row. Failing that, the spec
is warn-skipped through the existing `warnOnce` channel and never enters the backlog.

This is not a new mechanism. That loop's own comment states the requirement: *"The daemon
pre-seeds the front half (stories/plan = done) and never re-runs their gates, so this is the only
place specs are vetted before autonomous build. Reject unapproved or dependency-tree-less plans
rather than silently building them."* It already rejects stories that are not `Status: Accepted`
and plans with no dependency tree. A missing coherence artifact is the same class of defect and
gets the same treatment. The tier is already resolved in that loop (`daemon-backlog.ts:771`), so
the check's only input is in hand; the tier read moves earlier in the loop body.

*Rejected alternative — `park`.* Park operates on a feature already dispatched into a worktree
(`park-marker.ts`, `daemon-auto-park.ts:116-137`). It structurally cannot act "before BUILD
begins" for a spec that has not been dispatched.

*Rejected alternative — HALT.* `.pipeline/HALT` is an in-worktree marker raised after a step
fails in auto mode. By construction that is after BUILD began — precisely the failure mode
(a DECIDE step consuming the build retry budget) that this change removes.

### D4 — Discovery performs a shallow check; deep validation stays at land

Discovery checks presence and parseability only. The full semantic validator
(`coherence-validator.ts`: coverage layers, fabricated-id, duplicate-claim, waivers) remains
exclusively at `land` (`land-spec.ts:294-325`).

This is forced by the data available, not chosen for economy: the deep validator requires the
change set (git diff) to evaluate waiver freshness and layer engagement, and discovery reads the
base-branch tree via `tree.readFile` with no change set in scope. Duplicating the validator would
create two divergent notions of validity for one artifact. The shallow check is a backstop for
specs that bypassed `land` — hand-pushed spec branches, or the gate's own tier-S and
legacy-change-set disengagement paths (`coherence-validator.ts:1144-1154`).

### D5 — Engineer authoring owns the non-S coherence gate and artifact

After `plan`, `runAuthoring` invokes `coherence_check` for M and L tiers. The approved result is
written as `.docs/coherence/<slug>.md` and staged with the other authored DECIDE artifacts in the
single spec-branch commit. S-tier authoring skips the gate and writes no coherence artifact,
matching the existing tier exemption.

This is a production behavior change to the engine authoring seam, not a claim that the existing
flow was already complete. It keeps the daemon's discovery requirement and the engineer's
canonical DECIDE order coherent: the producer creates the required artifact before the consumer
vets it. The injected `decide` seam remains the test boundary; the implementation must cover both
the M/L invocation-and-commit path and the S-tier non-invocation path.

## Consequences

**Positive**
- No daemon-dispatched run executes a DECIDE authoring step; the first executed step returns to
  `acceptance_specs`.
- The failure mode observed at `daemon.log:7906-7911` — a build halted by a DECIDE step
  exhausting the build retry budget — becomes structurally impossible.
- Drift of the preseed set becomes impossible rather than merely corrected once; the class of
  defect is closed, not the instance.
- Tier applicability becomes explicitly assertable in state (`'skipped'` vs `'done'`).

**Negative / accepted costs**
- `daemon-backlog.ts` gains a third rejection path, so a previously-buildable merged spec that
  lacks a coherence artifact will now be warn-skipped. This is intended (it is outcome 3), but it
  is a behavior change against the existing backlog and must be called out in the plan so the
  operator can survey affected merged specs before the change lands.
- The `'done'` → `'skipped'` correction changes recorded state values for three other steps; any
  consumer keying off the literal `'done'` for those steps must be checked. `shouldSkipForUpstreamSkip`
  (`steps.ts:465-475`) is the known consumer, and no step declares `skipWhenSkipped` for any of
  the four, so no downstream skip cascade is expected.

**Deferred (explicitly out of scope)**
- Tightening the `coherence_check` post-step artifact glob `.docs/coherence/*.md`
  (`artifacts.ts:52`) to the plan stem. It is a real latent hole — any unrelated prior-feature
  file satisfies it — but it is independent of phase ownership, and once the daemon stops
  executing the step the glob is no longer load-bearing on the daemon path. Tracked as a
  follow-up.
- The `coherence_check` model-tier claim in `skills/coherence-check/SKILL.md:45` references a
  `DEFAULT_STEP_TIER_OVERRIDES.coherence_check.L` entry that does not exist in
  `provider-model-policy.ts:119-147`. Documentation defect, unrelated to this issue; follow-up.
