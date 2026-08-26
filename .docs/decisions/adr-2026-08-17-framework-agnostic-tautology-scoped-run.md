# ADR: the Tautology counterfactual is classified by exit code, never by runner output

**Date:** 2026-08-17
**Status:** APPROVED
**Deciders:** Engineer (DECIDE phase, #1682), operator-confirmed
**Relates to:** `adr-2026-07-07-build-review-judgement-gate.md` (the rubric whose evidence this
produces), `adr-2026-08-13-engine-managed-build-review-rubric-branches.md` (the fan-out lane that
consumes the projection), the `#1593` decision that a reverted-tree collection failure is RED, and
`adr-2026-08-11-halt-events-ride-the-persisted-spine.md` (the precedent for carrying diagnostic
detail on the event spine rather than in a sidecar)
**Supersedes:** nothing. **Does not change:** the four closed Tautology exceptions, the judged-result
schema, the grader's input isolation, the preflight cache key, selector derivation, or the
`test_suite.scoped_command` configuration contract.

## Context

Issue #1682. `classifyTautologyScopedFailure` (`step-runners.ts:191`) decided what a non-zero
counterfactual scoped run meant by matching regexes against combined stdout/stderr:

```text
no test files found | no tests? (found|collected) | ...   -> no-tests
assertionerror | assertion failed | tests? \d+ failed | ... -> test-failure
everything else                                            -> collection-failure
```

Both recognizing patterns are framework phrasing. `Test Files 1 failed` is Vitest; `AssertionError`
is pytest. RSpec reports `N examples, M failures` and matches neither, so every RSpec outcome — a
real example failure, a genuine load error, an empty run — reached the catch-all. So does `go test`,
JUnit, PHPUnit, and minitest. The filer observed this directly against real RSpec output.

Two further facts were established during DECIDE and change what the fix must be:

1. **The reported deadlock is already fixed on `main`.** `#1593` (2026-08-15) made a reverted-tree
   `collection-failure` a valid RED counterfactual, so `scoped-run-collection-failed` is unreachable
   in current code. The issue's evidence — `tautology kind=infrastructure-failure
   reason=provider-error detail=scoped-run-collection-failed` — came from an engine older than that
   commit. The defect that remains is not the deadlock; it is what the catch-all now *means*.
2. **Because the catch-all is RED, unrecognized output is silently promoted to evidence.** Before
   `#1593` an unrecognized runner produced a visible no-verdict. After it, an unrecognized runner
   produces counterfactual proof. The `no-tests` bucket — the one case that must *not* count as
   proof — is unreachable for every framework outside the two whose phrasing is hard-coded. A
   selector that matched no executable test is therefore counted as RED, and the gate **passes** on
   a test set that demonstrates nothing.

The repository already contains the correct pattern. `scoped-run.ts`, the other scoped runner, does
no output parsing at all: exit 0 is `passed`, non-zero is `test_failure`, and the process-level
conditions (launch failure, timeout) are separate. The Tautology preflight is the outlier.

## Decision

**The engine classifies the counterfactual scoped run by process outcome alone. It never reads
runner output to decide what happened.**

**D1 — Exit code is the classification.** `classifyTautologyScopedFailure` is deleted.
`runScopedTautologyCommand` maps the process outcome directly: a received signal is `signal`, exit
code 0 is the success variant, any non-zero exit is `nonzero-exit`, a spawn error is `launch-error`,
and an abort is `timeout`. No regex, no framework knowledge, no fallback bucket.

**D2 — The result union narrows to what the engine can justify.** `TautologyScopedRunResult` drops
`no-tests` and `collection-failure`; `test-failure` is renamed `nonzero-exit`, because an exit code
proves the process failed and does not prove an assertion ran. The infrastructure reasons
`scoped-run-no-tests` and `scoped-run-collection-failed` are removed with them. `scoped-run-failed`
is retained for the thrown-execution path. What remains infrastructure is exactly the process-level
set the engine observes without interpretation: `scoped-run-launch-failed`, `scoped-run-timeout`,
`scoped-run-signaled`.

**D3 — The evidence `runKind` follows.** `TautologyScopedRunEvidence.runKind` becomes
`'passed' | 'nonzero-exit'`. The bounded head+tail `failureExcerpt` on failed runs is unchanged, and
remains the only route by which runner-specific detail reaches a reader.

**D4 — "No executable test ran" becomes a judgement, not a bucket.** The judging skill gains a rule:
when the scoped-run excerpt shows the runner executed no test for a selector, that run is not
counterfactual evidence for that selector and the skill returns a finding. The skill already receives
the excerpt and `ranSelectors` in its closed projection, so this needs no new input.

**D5 — An infrastructure-failed scoped run retains its output on the event spine.** The
infrastructure-failure result gains an optional `failureExcerpt`, bounded by the existing
`boundedHeadTailExcerpt`, and the existing `build_review_rubric_infrastructure_failure` event gains a
matching optional `excerpt`. The detail lands in `.pipeline/events.jsonl` through the existing
`EventPersister`.

## Rationale

**Why deletion rather than more patterns.** Adding RSpec phrasing fixes RSpec and leaves `go test`,
JUnit, PHPUnit, and minitest in the catch-all. The repository's Design Principle names the shape
directly: a mechanism that needs an ever-growing exception list, whose deterministic core delegates
to string matching, is over-mechanized. A pattern table also fails silently — the next unlisted
runner produces no error, only a wrong classification — which is the hardest defect class to notice.

**Why the lost distinction is acceptable, and where it goes.** Deleting `no-tests` removes a
detection that genuinely worked for Vitest and pytest. That is a real cost and it is paid
deliberately: the detection was correct for two frameworks and silently wrong for the rest, and its
outcome was an infrastructure failure — a no-verdict, which is precisely the deadlock #1682 exists to
remove. Moving it to the judge converts a mechanical no-verdict into a routable finding, which is
strictly better for the operator: a finding names the selector, kicks back to `build`, and can be
fixed, while an infrastructure failure names nothing and can only be waited out. This is the
Principle's own carve-out — machinery for the bookkeeping, judgement where the question is a
judgement — and the answer stays schema-constrained.

**Why no control run.** A control run of the same selectors at HEAD, before the revert, would let the
engine distinguish "the harness cannot run here" from "the tests detect the revert", and would close
the remaining false-RED edge where a disposable checkout that cannot run tests at all counts as
proof. It was considered and rejected for this change on two grounds. It costs an additional
`test_suite` invocation on every lap whose counterfactual fails — the healthy, passing case — and the
operator's explicit constraint is to add no scoped invocations that are not needed. More importantly
it would *create* a new infrastructure-failure path, and therefore a new source of no-verdict, inside
the fix for a no-verdict deadlock. The failure it guards against is inferred, not observed: no
instance has been seen. If one is observed, the control run is a purely additive follow-up at the
same seam — one `runScoped` call before the revert loop — and nothing in this decision forecloses it.

**Why `#1593` is not reopened.** Desired outcome 2 asks that a run which fails to load its spec files
stay distinct from one that produced failing examples. On the *reverted* tree those are the same
verdict by design: a changed test that cannot even load once the diff's production is reverted has
demonstrably failed without the diff, which is exactly what the counterfactual asks. Restoring a
mechanical distinction there would require re-introducing the output parsing this decision removes.
The distinction survives where it is meaningful — in the excerpt the judge reads.

**Why the excerpt rides the spine.** Outcome 5 asks that the output stay retrievable "from the
feature's `.pipeline/` evidence", which invites persisting it under
`.pipeline/build-review-preflight/`. That directory is the disposable checkout and is removed on
every outcome, and writing a bespoke file there would be a second telemetry channel wearing an
existing directory as a disguise — invisible to the daemon, the UI, the report renderer, and the
OTel exporter. `.pipeline/events.jsonl` *is* `.pipeline/` evidence, the concern is an occurrence in
time, and an additive optional field on an existing variant is backward-compatible. The repository
already does exactly this for the `invalid-provider-result` infrastructure failure, which carries a
bounded raw-output excerpt in its diagnostic detail.

## Consequences

**Positive.** Every test runner is classified identically, so the gate's behavior no longer depends
on which framework a consumer project happens to use. A whole class of silent misclassification
disappears with the fallback bucket. The engine stops making claims its evidence cannot support
(`test-failure` from an exit code). An infrastructure failure becomes diagnosable after the fact
instead of leaving an operator with a bare label and a deleted checkout. Net code is deleted.

**Negative, accepted.** Vitest and pytest lose a mechanical no-tests detection that worked, and rely
on the judge for it — a judgement that can be wrong where a regex was deterministic. A disposable
checkout that cannot run tests at all still counts as RED; this is unchanged from today and remains
the known open edge, guarded only by the judge reading the excerpt.

**Neutral.** `runKind`'s value set changes, so the projection's `contentDigest` changes and existing
preflight cache entries miss once. Cached entries are per-process and bounded at 32; there is no
persisted cache to migrate.

## Alternatives rejected

1. **Add RSpec patterns to the existing chain.** Fixes one framework, leaves the rest, and grows the
   list the Principle warns about. Rejected.
2. **Make the classifier tech-context aware.** Keyed off the project's declared stack, this is the
   same table with indirection, and it fails closed on any project whose stack is undeclared or
   mixed. Rejected.
3. **Exit-code classification plus a control run at HEAD.** Strictly more evidence, and the right
   answer if a broken-harness false RED is ever observed. Rejected for now on invocation cost and on
   introducing a new no-verdict path into a no-verdict fix. Recorded as the additive follow-up.
4. **Persist the infrastructure excerpt under `.pipeline/build-review-preflight/`.** A parallel
   telemetry channel by the event-spine skill's schema-not-file test, and written into a directory
   that is deleted on every outcome. Rejected.

> **Amended 2026-08-22 by #1805:** rubric membership is now the registry with test-quality as the only member (default off), an empty enabled set is a valid no-dispatch PASS, and retired rubric keys are accepted as no-ops; four-rubric enumerations here narrow to the registry (adr-2026-08-22-build-review-opt-in-rubric-container).
