# Architecture Review: Gate satisfied without dispatch leaves no state key, so FINISH invalidates forever

**Date:** 2026-09-14
**Tier:** Medium (lightweight mode — Sections 2 and 4)
**Source:** jstoup111/ai-conductor#1587
**Stories reviewed:** none yet — this review runs pre-stories per
adr-2026-06-29-architecture-before-stories-convergent-kickback. Input is the explore output and the
narrowed scope boundary in `.docs/track/gate-satisfied-without-dispatch-leaves-no-state-ke.md`.
**Verdict:** APPROVED WITH CONDITIONS

## Scope under review

Binding scope boundary, taken from the track marker and not widened here:

1. FINISH's implementation-evidence observation consults the gate-verdict layer through the same
   `gateSatisfied` predicate the loop already uses.
2. The block/kickback diagnostic names which step's predicate is unsatisfied, carried as a typed
   facet rather than derived from message text.

The issue's first desired outcome (persist a step status when a gate resolves without dispatch) and
the cumulative `finish` bound were both removed from scope during explore. Their refusals are
recorded in the track marker and restated under Alignment below.

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new dependency, runtime, or service. Both changes are edits to existing TypeScript modules in `src/conductor/src/engine/`. |
| Prerequisites | None. `gateSatisfied` (`selector.ts`) and `readAllVerdicts` (`gate-verdicts.ts`) are already exported and already consumed by the resume clamp and the loop tail. |
| Integration surface | Two modules: `finish-publication-production.ts` (the observer) and `finish-publication.ts` (the condition/route types). `conductor.ts` is touched only to carry the facet into the existing kickback evidence string. No module boundary is crossed that these three do not already cross. |
| Data implications | None. No schema, no migration, no new durable file, no new field in `conduct-state.json` or the kickback ledger. |
| Performance risk | The observer gains one `readAllVerdicts` call — a `readdir` plus a small JSON read per gate — executed once per FINISH entry, not per loop iteration. Negligible against a step that already performs git and GitHub observation. |
| Worktree isolation | Unaffected. Verdicts are already per-worktree under `.pipeline/gates/`; no shared port, database, or path is introduced. |

**Verified claim (99%):** `observeImplementationEvidence` currently reads step state only —
`stepDone(state, 'build_review') && stepDone(state, 'test_suite')` in
`finish-publication-production.ts`. Read directly from the file at this HEAD.

**Verified claim (97%):** the condition is live in production, not historical. Five
`finish_publication_blocked` / `implementation_evidence_invalid` occurrences across four features
between 2026-08-21 and 2026-09-08, read from `.daemon/evals-raw/features/*/events.jsonl`. The most
recent post-dates #1487's merge by three weeks, so #1487's non-advancing-transition guard
demonstrably does not cover this path — consistent with `implementation_evidence_invalid` returning
the distinct `implementation_invalid` kind that bypasses that guard.

## Alignment

### The change applies an existing governing decision; it does not make a new one

**adr-2026-07-11-verdict-aware-resume-entry** is the governing ADR and it already decides this
question:

> "4. `checkGate` unchanged. Prerequisite checking stays state-only; the authority for 'is this
> gate actually satisfied' is the verdict layer, applied at entry (this ADR) and in the loop tail."
> "5. One authority. No new satisfaction predicate is introduced; the clamp calls the same
> `gateSatisfied` used by `selectNextGate`, so entry and tail can never disagree on semantics."

FINISH's implementation-evidence observer is the remaining gate-satisfaction consumer that does not
call `gateSatisfied`. Redirecting it is conformance to D4/D5, not a departure from them. Per §7's
structural prerequisite and reuse check, **no new ADR is warranted**: the change establishes no
system boundary, no component decomposition, no integration pattern, no state or data architecture,
and no foundational technology. It brings one consumer into an existing rule.

### The excluded alternatives are excluded because approved decisions refuse them

- **Persisting a status at gate resolution** is adr-2026-07-11's rejected Option C
  ("side-effectful read (resume mutates state), reconciliation-by-copy keeps two authorities"),
  refused again by adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch D3 ("The re-check
  reads; it never writes... This is what distinguishes the decision from adr-2026-07-11's rejected
  Option C, and the distinction is the reason that rejection is not reopened"), and by
  adr-2026-08-03-build-repair-member-reuse-validity ("No on-disk gate verdict, step status, or
  timestamp is sufficient authority on its own"). Additionally
  adr-2026-07-26-daemon-decide-preseed-ownership D2 forbids `done` as the written value, since
  stamping `done` asserts an artifact was produced.
- **A cumulative `finish` bound** is refused by adr-2026-08-16-restore-the-current-head-publication-fence
  D5 ("Bounding is inherited, not invented. No new counter, allowance, or cap is introduced") and
  falls outside adr-2026-08-12-cumulative-build-review-convergence-bound D6's declared
  `build_review`-only scope.
- **Repairing `bumpKickbackGate`'s reset** is refused by
  adr-2026-07-26-cross-dispatch-kickback-livelock-bound D3, where the tree-hash reset is the
  deliberate decision ("genuine progress earns a fresh budget").

### One tension, reconciled and recorded

**adr-2026-08-01-engine-owned-resumable-finish-publication** D1 requires the publication snapshot to
derive from "authoritative repository and external evidence" and states that markers "are not
trusted without their corresponding git or GitHub evidence."

**Reconciliation (confidence 92%, inferred):** D1's clause governs *publication* markers — PR
identity, push state, shipped record, changelog — each of which has a git or GitHub counterpart to
verify against. Implementation evidence (`build_review`, `test_suite`) has no git or GitHub
counterpart. Its evidence-derived artifact is the gate verdict, which `computeAndWriteVerdict`
recomputes from on-disk evidence through `checkGateCompletion`. Reading that verdict is therefore
*more* evidence-grounded than reading a raw state key, which is what the code does today. D1 is
satisfied more closely after this change than before it.

This reconciliation is recorded here rather than as an ADR amendment because the two decisions do
not actually conflict once D1's clause is scoped to publication markers; adr-2026-07-11 D4 already
names the verdict layer as the authority for gate satisfaction. Condition 3 below preserves this
citation for the as-built reviewer.

### The diagnostic must be a typed value, not a parsed string

- adr-2026-08-19-unretryable-step-runner-failures-route-by-kind D1-D3: route on a typed result
  kind, never on reason text; the halt names the failing step and the step that must re-run. This
  is the affirmative authority for scope item 2.
- adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane D1 and adr-2026-09-05 D5: no consumer
  may match on message text.
- adr-2026-07-11-finish-step-engine-completion-machinery D4 already established a machine-readable
  facet code alongside `reason` on the finish predicate result. That is the seam to extend.
- adr-2026-08-08-finish-human-required-halt-rendering: a new reason needs a closed-union member
  plus a guidance row, never free text.

### Pattern basis (focused, this concern only)

**Precedent:** the resume clamp's own verdict read in `conductor.ts` — `readAllVerdicts` feeding
`earliestUnsatisfiedGateIndex`/`gateSatisfied`, wrapped so that a verdict-read failure is
non-fatal.

**Traits to preserve:** read all verdicts once per entry rather than per gate; pass them into
`gateSatisfied` alongside state rather than consulting either alone; treat an unreadable verdict
directory as absence of verdicts and fall back to state, never as an exception that escapes.

**Why it applies:** the observer is doing the same read for the same question at a different entry
point, and adr-2026-07-11 D5 requires the semantics not diverge between entry points.

**Allowed variation:** where the read is placed inside the production wiring, and whether the
verdict map is computed eagerly at observer construction or lazily inside the closure.

**Rediscovery hints:** `src/conductor/src/engine/conductor.ts`, the `readAllVerdicts` call inside
the `this.resume` branch; `src/conductor/src/engine/selector.ts`, exported symbol `gateSatisfied`.

### Failure direction is preserved

A gate with an unsatisfied verdict still blocks FINISH. A gate with no verdict and no state key
still blocks FINISH — `gateSatisfied` falls back to state, and absent state is unsatisfied. A
`stale` step still blocks, because `gateSatisfied` returns false for `stale` before consulting the
verdict. The change removes only the case where the loop resolved a gate and FINISH disagreed.

## Wiring Surface

No new production surface is introduced. Both changes modify surfaces that already have production
callers:

| Surface | Kind | Production wiring at design time |
|---|---|---|
| `observeImplementationEvidence` | Existing port method on `PublicationObservationPorts.filesystem` | Already invoked by `observePublicationSnapshot` in `finish-publication.ts`, which the FINISH step reaches through the publication coordinator. Its body changes; its call path does not. |
| Unsatisfied-step facet | New field on the existing `implementation_evidence_invalid` condition and the `implementation_invalid` result | Produced in `preflightFinishPublication`, carried through `advanceFinishPublicationUnreconciled`'s `implementation_invalid` return, consumed in `conductor.ts`'s `retry_build` branch where the kickback evidence and the `pendingRetryHints` entry for `build` are composed. That branch is already reached on every occurrence of this condition — five times in production between 2026-08-21 and 2026-09-08. |

No new exported module, hook script, config key, scheduled job, or CLI subcommand. The facet is a
field on an existing emitted value, so no new `ConductorEvent` member and no `EVENT_SINKS` entry is
required — the existing `kickback` and `finish_publication_blocked` occurrences already carry this
route.

**Early overlap scan:** `ai-conductor overlap-scan --files` over the three target paths reports
"No overlap detected; no open blockers." Advisory only.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| The verdict layer reports satisfied for a gate whose artifacts have since been invalidated, letting FINISH publish on stale proof | Technical | Low | Medium | `gateSatisfied` returns false for `stale`, and the rebase/publication fences already recompute verdicts before FINISH. The change does not weaken either. Negative-path stories must cover a `stale` step and an unsatisfied verdict. |
| Reading verdicts inside the observer throws where the current state read cannot, converting a block into an exception | Technical | Low | Medium | `safelyObserve` already wraps every observer and maps a throw to `unavailable` → `indeterminate`, which is a distinct condition from `invalid`. Follow the resume clamp's tolerant-read precedent so absence reads as absence. |
| The facet is threaded but no consumer renders it, leaving the diagnostic unchanged in practice | Integration | Medium | Medium | The Wiring Surface names the exact consumer (`conductor.ts`'s `retry_build` branch). A story must assert the rendered kickback evidence names the step, not merely that the field is populated. |
| A future reader re-derives the adr-2026-08-01 D1 tension and disputes the design | Knowledge | Medium | Low | Condition 3 preserves the reconciliation and its citations in this committed artifact. |

## ADRs Created

**None.** The structural prerequisite in §7 is not met: the change establishes or revises no system
boundary, component decomposition, integration pattern, state/data architecture, or foundational
technology. The governing decisions already exist and are cited above — principally
adr-2026-07-11-verdict-aware-resume-entry D4/D5 for the observer redirect, and
adr-2026-08-19-unretryable-step-runner-failures-route-by-kind plus
adr-2026-07-11-finish-step-engine-completion-machinery D4 for the typed facet.

**None superseded.**

## Conditions

1. **The observer introduces no new predicate.** It must call the exported `gateSatisfied` from
   `selector.ts` with the same `(step, state, verdicts)` triple the resume clamp and the tail use.
   A reimplementation of the satisfaction rule inside `finish-publication-production.ts`, however
   faithful, violates adr-2026-07-11 D5 and is rejected at review.

2. **No state write.** This change writes nothing to `conduct-state.json`. Any diff that persists a
   step status at a gate-resolution or observation site re-opens adr-2026-07-11's Option C and
   adr-2026-08-19 D3 and must be rejected.

3. **The unsatisfied step travels as a typed field.** No consumer may derive the step name by
   matching on `'Implementation evidence is invalid. Re-run the BUILD verification, then retry
   FINISH.'` or any other reason text. If the diagnostic is produced by string inspection, the
   condition is unmet regardless of the rendered output being correct.

4. **Tolerant verdict read.** An unreadable or absent `.pipeline/gates/` directory must read as
   "no verdicts" and fall back to step state, matching the resume clamp. It must not throw, and it
   must not be silently converted into `satisfied`.

5. **Deferred, not dropped.** Two findings surfaced during review sit outside this scope boundary
   and must not be absorbed into it. They are recorded here so they are not lost:
   - The `finish` kickback gate captures a D2 no-op baseline via
     `captureKickbackToBuildContext('finish')` that nothing ever consumes —
     `checkKickbackToBuildEscalation('finish')` is never called, unlike every other kickback gate.
     Under adr-2026-07-13-kickback-build-no-op-escalation D2 this is the already-approved bound, and
     wiring it would need no new counter and no amendment to adr-2026-08-16 D5.
   - The `retry_build` branch in `conductor.ts` marks `test_suite` and `build_review` stale
     unconditionally and writes them through raw `Record<string, unknown>` casts. This contradicts
     adr-2026-07-26-rebase-tail-current-branch-before-publication D5 ("marks only the non-green
     applicable members `stale`") and bypasses adr-2026-08-01-conduct-state-mutation-port's
     production-writer rule.

   Both warrant their own intake issue. Neither may be fixed opportunistically inside this feature's
   diff — doing so would widen the operator-confirmed scope boundary without confirmation.
