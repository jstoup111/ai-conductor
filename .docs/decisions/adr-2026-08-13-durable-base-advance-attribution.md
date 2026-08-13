# ADR: base-advance attribution is a durable spine record, not a gate-verdict field

**Date:** 2026-08-13
**Status:** APPROVED
**Deciders:** Engineer (DECIDE phase, intake #1535), operator-confirmed
**Relates to:**
`adr-2026-07-23-build-review-fresh-base-disposition.md` (introduced the rebase-repair exception this
ADR re-sources),
`adr-2026-07-20-post-rebase-delta-aware-invalidation.md` (owns `changedCodePaths` and gate
invalidation, which this ADR deliberately does not change),
`adr-2026-07-07-build-review-judgement-gate.md` (the grader whose repair-context block is fed),
`adr-2026-08-12-removal-anchored-tautology-exemption.md` (the sibling evidence block; same
"evidence, not exemption" framing),
`adr-2026-08-13-markdown-default-inversion.md` (the classifier fix this ADR depends on)
**Supersedes:** nothing.
**Does not change:** the `build_review` rubric wording, the all-or-FAIL rule, the grader's input
isolation, the verdict schema, or which gates a rebase invalidates.

## Context

Intake #1535. On the feature `repeated-build-review-semantic-failures-can-churn-`, `main` deleted
`agents/planner.md` mid-build. A branch test still read that file, the suite failed with `ENOENT`,
the build correctly deleted the now-dead test, and `build_review` then graded that deletion as
unplanned:

```text
[tautology] deletes the planner import and its test without a corresponding production change;
no recorded rebase-repair context authorizes the stale-base exception.
[scope] removes unrelated planner-contract coverage; no plan step concerns the retired
planner persona.
```

The repair ledger the grader reads was never written. The chain, verified against source:

1. `applyRebaseVerdicts` (`rebase.ts:1156`) stamps `kickback:{from:'rebase'}` onto the invalidated
   gate verdicts. This is the only place the "base moved" fact is recorded in a form the repair
   path consults. Confidence 100%, basis: verified.
2. `computeAndWriteVerdict` (`gate-verdicts.ts:63-71`) constructs a **fresh** verdict object from
   `{satisfied, reason, checkedAt}` alone. The `kickback` field is erased the next time that gate
   runs. Confidence 100%, basis: verified.
3. `recordTestSuiteRebaseRepair` (`conductor.ts:2401-2405`) asks the **`build_review`** verdict
   whether a **`test_suite`** failure was rebase-caused. Confidence 100%, basis: verified.
4. `recordTestSuiteRemediation` returns early unless that predicate holds
   (`test-suite-remediation.ts:124`), so the ledger stays absent and
   `assembleBuildReviewInputs` (`build-review-inputs.ts:140-142`) renders an empty repair block.
   Confidence 100%, basis: verified.

### The load-bearing correction

The fact "a base advance invalidated branch work" is **durable** — it stays true for the rest of
the feature's build, across every subsequent gate lap. Its carrier is **transient**: a field on a
file that is rewritten in full on every gate run. A durable fact on a transient carrier is the root
cause. Everything else — the wrong gate being consulted, the one-record cap, the `test_suite`-only
call sites — is a consequence of having no durable place to put it.

Two further defects compound it, both verified:

- `consumedInvalidations` keys on the rebase verdict's `checkedAt`
  (`test-suite-remediation.ts:126`), so at most **one** repair can ever be recorded per base
  advance. A base advance that invalidates two tests can only ever explain one of them.
- Both call sites (`conductor.ts:4705`, `:7206`) are gated on `fullSuiteVerification`, so only
  `test_suite` can produce a record. Any other gate observing a base-advance-caused failure
  produces nothing.

### Why the spine, and why it does not work today

`.pipeline/events.jsonl` is append-only, per-feature-worktree (`event-persister.ts:189-201`), and
already co-located with the repair ledger. It is the correct carrier, and the schema already exists:
`rebase_changed{changedPaths}` and `rebase_gate_invalidated{gate, matchedPaths}`
(`types/events.ts:560-591`).

It does not work today because both are declared `persist: false` (`event-sinks.ts:65,68`), so
`EventPersister` — which subscribes only to `persistedEventTypes()` (`event-persister.ts:59-62`) —
never writes them. Confidence 100%, basis: verified. This is a sink-flag change, not a new channel:
per this repository's event-spine principle, the concern the spine already models keeps riding the
spine.

## Decision

**Base-advance attribution becomes a durable, append-only record on the existing event spine, and
repair recording becomes gate-agnostic and unbounded per advance.**

### D1 — The base-advance record is persisted, and carries the unfiltered delta

`rebase_changed` and `rebase_gate_invalidated` become `persist: true`. `rebase_changed` gains a
field carrying the **unfiltered** rebase delta — every path the advance touched, before
`filterCodeOrTestPaths` is applied.

**Emission condition (amended 2026-08-13 by conflict-check, operator-confirmed).** The record is
written whenever the base actually advanced — including an advance whose entire delta is excluded
documentation, which the outcome classifier reports as a no-op. Emission and invalidation are
separate questions: invalidation stays driven by the filtered delta exactly as today, so a
documentation-only advance still preserves every gate verdict and `adr-2026-07-20` is untouched.
Without this separation the record would be absent precisely when the delta consists of paths the
filter excludes, which is the case attribution most needs it for. The concrete exposure:
`test/test_docs_navigation.sh:179-249` asserts against the real `docs/` tree, and this repository's
gating `maintain-documentation` step makes `docs/` changes routine on main.

`changedCodePaths` keeps its present meaning and its present consumers untouched: it answers "what
invalidates a gate's judgement", which is
`adr-2026-07-20-post-rebase-delta-aware-invalidation.md`'s question. The new field answers a
different question — "what file reads on this branch might now fail" — and those are not the same
set. Carrying both is deliberate defence in depth: the companion ADR fixes the classifier so the
filtered set would also have covered this incident, and the unfiltered field ensures attribution
survives a future classifier error rather than silently regressing to today's behavior.

### D2 — Attribution is a join over the record, requiring path overlap

`wasInvalidatedByRebase` is removed. A gate failure is attributed to a base advance when **both**
hold:

1. the failure was observed after that advance was recorded, and
2. the failure's diagnostic implicates a path the advance changed.

**The join looks back over the feature's whole recorded history, not over the current lap.** This
is load-bearing, and it is why the record must be append-only. Verified step order is
`build`(`steps.ts:143`) → `test_suite`(169) → `build_review`(181) → `rebase`(271) →
`finish`(281): the in-loop rebase is a **finish-time** step that runs *after* `build_review`, then
invalidates gates and navigates back to `build`. A base advance is therefore observed by
`build_review` on the *following* lap. A second, genuinely pre-loop path also exists
(`resumeRebaseFirst`, `daemon-cli.ts:1079`). A lap-scoped join would have been inert on the very
incident this ADR addresses.

Path overlap is **required**, not optional. A time-window join alone would attribute every
post-rebase failure to the rebase, which would turn a base advance into blanket permission to
delete coverage — the explicit anti-goal in #1535's desired outcomes. A genuinely unplanned
deletion touches no advanced path and therefore records no repair, so it is still flagged exactly
as today.

### D3 — Recording is gate-agnostic and accrues N records per advance

The recorder takes the observing gate as a parameter rather than being hardcoded to `test_suite`.
Records are keyed on `(advance identity, failure identity)`, replacing the
`consumedInvalidations` cap, so one advance that invalidates several things produces several
records. The existing content-hash failure identity is retained, so repeated observations of the
same failure remain idempotent across rebases.

### D4 — Grading provenance is recorded on the spine

When `build_review` grading assembles its inputs, it records whether repair context was available
and, when empty, which case applies: no base advance occurred, or an advance occurred but no
failure joined to it. This rides the spine as an event, not a sidecar file. An operator reading a
run's artifacts can then distinguish "graded with repair context", "graded with none because none
was warranted", and "graded with none because attribution found no join" — which is precisely the
distinction that was unavailable while diagnosing this incident.

### D5 — Evidence, not exemption

The repair record does not exempt a diff hunk from grading. It is evidence the grader weighs, in
the same framing `adr-2026-08-12-removal-anchored-tautology-exemption.md` uses for its removal
block. `build_review` remains responsible for judging whether a hunk actually implements a recorded
repair. The existing prompt wording already frames the block this way and is unchanged.

## Assumptions

Verified in full by the `/verify-claims` pass recorded at
`.pipeline/verify-claims-architecture-review-1535.md` (2026-08-13).

| Assumption | Confidence | Basis | Impact if wrong | Confirmation |
|---|---|---|---|---|
| Adding persisted event types is backward-compatible for existing `events.jsonl` readers | **Verified** | Every reader uses a positive type filter, never a closed-set assumption — `cost-rollup.ts:128,146,169,174`, `timing-rollup.ts:46-52,96,107`, `daemon-dashboard.ts:416,422,450` | — | Settled |
| `emitRebaseEvent` reaches the feature-scoped emitter during a daemon build | **Verified** | Chain traced end to end: `daemon-cli.ts:910` → `daemon-runner.ts:394-399` → `new Conductor({events: featureEvents, projectRoot: wt.path})` (`daemon-cli.ts:1000-1010`). The pre-loop re-kick path agrees (`daemon-cli.ts:1079-1082` → `daemon-rekick.ts:563`) | — | Settled — this was the design's highest-risk assumption |
| Ledger writer, event writer, and ledger reader address one directory | **Verified** | `this.projectRoot === wt.path`; `EventPersister` writes `wt.path/.pipeline/events.jsonl`; `featureRoot = dirname³(planPath) = wt.path` (`build-review-inputs.ts:130`) | — | Settled |
| A failure diagnostic reliably names the path that caused it | 75% | Inferred — true for the observed `ENOENT` and for ordinary module-resolution failures; not guaranteed for every framework's output | Under-attribution: no repair record, grader behaves as today | Not blocking — fails in the safe direction (can only under-attribute, never fabricate a record); a story covers the no-join path explicitly |

Emission is best-effort (`emitRebaseEvent` swallows errors, `rebase.ts:1275`). A dropped emission
therefore yields no repair record and today's grading behavior — degraded, never incorrect.

## Alternatives considered

- **Persist a durable `invalidatedByRebase` field on the gate verdict.** Smallest diff, no causal
  join. Rejected: it keeps a durable fact in a file that every gate run rewrites, requires auditing
  every current and future verdict writer not to clobber it, and cannot express more than one
  repair per advance without a second store anyway.
- **Give the grader the raw base-advance delta and let it judge (no ledger).** Removes the join
  entirely. Rejected: it substitutes LLM judgement for a deterministic engine record, against this
  repository's deterministic-where-possible principle, and still needs a durable pre-advance
  merge-base.
- **Time-window join with no path requirement** (the filer's hypothesis). Rejected as the sole
  criterion for the reason in D2; retained as one of the two conjuncts.
- **A new sidecar file recording base advances.** Rejected outright by the event-spine principle —
  the spine already models this concern and every consumer reads it.

## Consequences

- Two event types begin appearing in `.pipeline/events.jsonl`. Additive; readers filter by type.
- The repair ledger can hold several records per advance, so the grader's block may list more than
  one entry. The prompt already renders a list.
- Attribution remains best-effort by construction. When the join finds nothing, grading is exactly
  today's behavior, and D4's provenance record says so explicitly rather than leaving an operator
  to infer it from an empty block.
- `wasInvalidatedByRebase` and its tests are deleted. This is itself removal maintenance and is
  expected to be graded against `adr-2026-08-12-removal-anchored-tautology-exemption.md`.
