# ADR: A publication transition advances only when it moves the dimension it owns

**Date:** 2026-08-13
**Status:** APPROVED (operator, 2026-08-13)
**Deciders:** James Stoup (operator), engineer session for intake ai-conductor#1487
**Feature:** FINISH publication burns its retry budget on an unreachable transition (ai-conductor#1487)
**Related:** `adr-2026-08-01-engine-owned-resumable-finish-publication.md` (re-observation is the sole
routing authority — preserved by this decision),
`adr-2026-08-06-publication-progress-is-its-own-disposition.md` (a verified advance is its own
disposition — this ADR tightens what "verified" means),
`adr-2026-08-06-bounded-progress-allowance-for-finish-publication.md` (the total allowance that
discharges the termination obligation — retained, but no longer the first line of defence),
`adr-2026-08-09-one-pr-per-branch-halt-is-a-state.md` (halt is a state on the PR — the governing
decision this ADR applies to the observer, rather than restating)

## Context

The FINISH publication coordinator runs a three-part loop: observe a closed snapshot
(`observePublicationSnapshot`, `finish-publication.ts:175-209`), select one transition from it
(`nextFinishPublicationTransition`, `:357-400`), then perform at most one effect and re-observe
(`advanceFinishPublication`, `:1216-1516`). `adr-2026-08-01-engine-owned-resumable-finish-publication`
made the fresh observation the sole authority for the next selection, which is what makes the step
resumable and idempotent.

That design has a gap it never closed: **nothing checks that the effect actually moved the
observation the selection was derived from.** A transition may complete, report `advanced`, and
leave the snapshot byte-identical — in which case the next pass re-derives the same selection from
the same inputs and runs the same effect again. The loop is idempotent but not convergent.

Two instances are live at HEAD (`92734d3e7`), both entered from an auto-opened
`needs-remediation` placeholder PR, which the production classifier `prProse`
(`finish-publication-production.ts:120-133`) labels `halt` from a `needs-remediation:` title prefix
or the `HALT_PR_BANNER_SENTINEL` in the body. `halt` is neither `placeholder` nor `accepted`, so
the selector (`:379`, `:383`) routes it to `judge_pr_prose` and nothing else can ever be selected:

**Cycle A — the filed symptom.** The judge returns `revision_required` with reason `placeholder`.
`mapPrProseJudgmentResult` (`:1176-1186`) maps that to a `publication_retry` that *names* the
transition `author_pr_prose`, with reason `authoring_required_after_judgment`. But
`routeFinishPublicationDisposition` (`:671-674`) discards the named transition and forwards only the
reason, and the next pass re-derives the stage from a fresh observation in which `pr.prose` is still
`halt` — never `placeholder` — so `isPrProseAuthoringNeeded` (`:996-1000`) is false and judgment is
selected again. The `judgmentByRevision` memo (`finish-publication-production.ts:154-155`,
`:288-296`) is keyed on the PR's title/body revision and caches terminal verdicts, so every
subsequent lap returns the identical verdict with **no provider call**. Six attempts, five of them
sub-millisecond, then `FINISH publication retry exhausted: authoring_required_after_judgment` — a
halt reason naming a transition that never ran.

**Cycle B — same root, different exit.** The judge returns `accepted`. That maps to `advanced`
(`:1141`) → `publication_progress` → `progress_finish`, and the conductor refunds the attempt
(`conductor.ts:6120`). Judgment writes nothing to the PR, so the re-observation is identical, prose
is still `halt`, and judgment is selected again — fourteen free laps until
`FINISH_PUBLICATION_PROGRESS_ALLOWANCE` (`finish-publication.ts:348`) trips with "progress allowance
exhausted".

The two existing bounds are both *terminal* counters: `stepMaxRetries` (6) and the progress
allowance (14). Neither can distinguish fourteen distinct advances from the same advance fourteen
times, because neither observes sameness. `adr-2026-08-06-bounded-progress-allowance` said as much
when it recorded a per-transition stuck cap as an available follow-up rather than building it. The
forces have since changed: what #1487 shows is not that the bound is too loose, but that a
non-advancing transition is reported as an advance at all.

## Options Considered

### Option A: Observation fixed-point guard — each transition declares the dimension it owns

Each transition names the slice of `PublicationSnapshot` it is responsible for moving. The
coordinator fingerprints that slice before dispatching the effect and again on the mandatory
re-observation it already performs, and reports `advanced` only when the fingerprint changed. An
effect that completes without moving its own dimension resolves `human_required` on the first
occurrence.

- **Pros:** Convergence becomes a property of the machine rather than a per-reason allowlist —
  every present and future transition is covered by the same rule, including ones nobody has
  written yet. Preserves re-observation as the sole authority. Uses only observations the
  coordinator already makes; no new port, no cross-process state, no new telemetry channel. The
  halt fires on the first non-advance, so the operator sees the real condition instead of an
  exhausted budget. Deterministic engine machinery, which is what this repository's design
  principle asks for.
- **Cons:** Requires a correct dimension map — a transition mapped to too broad a slice can be
  masked by unrelated churn; mapped too narrowly it can false-halt a legitimate advance. Adds a
  `HumanRequiredReason` member and therefore a guidance-table entry
  (`finish-publication.ts:469-510`, rendered by `renderHumanRequiredHaltReason` `:619-631`).

### Option B: Honor the returned transition, plus a repeat-verdict detector

Have the coordinator obey the `transition` a disposition names on the next pass instead of
re-deriving the stage, and treat a stage that re-selects itself with an unchanged verdict as
non-converging.

- **Pros:** Closest to the filer's own sketch. Directly repairs the specific discard at `:671-674`.
- **Cons:** Re-couples routing to a decision made against a snapshot that is by then stale — exactly
  the coupling `adr-2026-08-01-engine-owned-resumable-finish-publication` removed to make the step
  resumable. A named transition surviving a process restart or a concurrent GitHub-side change is
  precisely the class of bug re-observation exists to prevent. The repeat-verdict detector also
  covers only verdict-bearing transitions; the other six get no guard.

### Option C: Collapse the judge verdict vocabulary and the observer's prose classification

Model prose state once and derive both the observation and the verdict vocabulary from it, making
disagreement unrepresentable.

- **Pros:** Removes the whole disagreement class at the root. Genuinely addresses the filer's first
  hypothesis.
- **Cons:** Largest blast radius in the module; `skills/finish/SKILL.md` is load-bearing test input
  (`test/engine/finish-pr-prose-judgment.test.ts:15` asserts exactly the documented verdict set), so
  the provider contract changes too. Bumps the tier to L. And it fixes only the prose stages — the
  non-convergence mechanism is general, so the other transitions stay unguarded.

## Decision

**Adopt Option A.** A publication transition reports `advanced` if and only if the observation
dimension it owns changed across the effect. A transition that completes without moving its own
dimension is a defect in the machine's own terms and resolves `human_required` immediately — no
retry consumed, no progress tick, and a reason that names the stage that ran and the dimension that
did not move.

> **Amended 2026-08-13 by #1487:** the rule above governs the `advanced` path only, and that is not
> sufficient. `advancedPublicationTransition` is reached solely when a transition arm reports
> success — the judgment arm returns `result.kind === 'advanced' ? advancedPublicationTransition(…)
> : result` (`finish-publication.ts:1342-1344`), so a `publication_retry` disposition bypasses the
> guard entirely. Cycle A is a retry, which means the decision as first written fixed Cycle B and
> left the filed defect intact. Operator-confirmed 2026-08-13, during the coherence consistency
> pass.
>
> The decision therefore extends to the retry path, which is also what
> `.pipeline/intake-outcomes.md`'s first desired outcome asks for in as many words — *"a publication
> retry either performs the transition it names, or resolves as human-required"*:
>
> **A `publication_retry` that names transition T resolves `human_required` when the fresh
> observation would not select T.** A retry naming a transition the selector will not choose is a
> retry that provably cannot perform what it names; re-running it can only re-derive the same stage
> from the same inputs. The test is the existing pure selector
> `nextFinishPublicationTransition` (`:357-400`) applied to the post-effect observation — no new
> predicate, and the same fixed-point idea as the advance-path rule: a disposition that cannot move
> the machine is not progress.
>
> This subsumes the narrower alternative of stopping
> `mapPrProseJudgmentResult`'s `revision_required/placeholder` arm from emitting a retry that names
> `author_pr_prose` (`:1176-1186`). That arm is left as written: the rule is general, so it covers
> every retry reason, including ones not yet authored, rather than special-casing the one verdict
> pair that happened to be observed.

> **Amended 2026-08-28 by #2006:** production experience surfaced a new force the 2026-08-13
> amendment created: for authored-but-judged-deficient prose, the retry-path rule converts Cycle A
> from a livelock into a deterministic `human_required` deadlock. The observation vocabulary has no
> way to express "authored, judged, found deficient" — such prose observes as `stale`, the selector
> names `judge_pr_prose`, the judgment's persisted `revision_required` verdict emits a retry naming
> `author_pr_prose`, and the retry-path rule above correctly reports the mismatch — forever, at
> zero provider cost, because the persisted verdict short-circuits every re-dispatch. The designed
> `authoring_required_after_judgment` repair lap is unreachable in production
> (issue #2006; first stuck feature `remove-retrospectives-full-and-micro-from-feature-`).
>
> **Option C is therefore adopted in a narrowed form.** The full collapse (one prose model deriving
> both vocabularies) stays rejected on its original blast-radius grounds. The narrowed form adds one
> member to the observer's prose classification — `revision_required`, derived at observation time
> from the persisted judgment store (`.pipeline/prose-judgment.json`) when the observed revision's
> digest carries a `revision_required` verdict with reason `placeholder` or
> `structurally_incomplete` — and routes it to `author_pr_prose` in `nextFinishPublicationTransition`.
> Observation remains the sole routing authority (Option B stays rejected: no disposition's named
> transition is ever honored over a fresh observation); the retry-path rule above stays in force
> verbatim and simply stops firing for this cycle by construction, because the fresh observation now
> selects the same transition the retry names. Classification precedence is explicit:
> `halt` (via `hasHaltSignal`) strictly precedes `revision_required`, so a halted PR still resolves
> `human_required` before any authoring or judgment dispatch, and a `revision_required` verdict with
> reason `halt` keeps its `judgment_halt_prose` human-required routing. In the dimension map,
> `author_pr_prose` continues to own `pr.prose`: a successful authoring pass moves
> `revision_required` → `stale` (a new revision digest with no persisted verdict), so the
> advance-path guard still catches an authoring pass that leaves the revision byte-identical. The
> bounded progress allowance is still retained unchanged as the termination backstop for
> non-converging author→judge laps; its "no provider dispatch except judgment" cheapness premise now
> also admits the authoring dispatch, accepted because both are bounded by the same allowance.
> `skills/finish/SKILL.md`'s documented verdict contract moves with this vocabulary, as this ADR's
> Option C analysis anticipated.

The dimension map is total over `PublicationTransition`:

| Transition | Dimension it owns |
|---|---|
| `establish_pr` | `pr.identity` and `branchPushed` |
| `verify_release_readiness` | `releaseReadiness` |
| `author_pr_prose` | `pr.prose` |
| `judge_pr_prose` | `pr.prose` |
| `write_shipped_record` | `shippedRecord` |
| `ready_pr` | `pr.ready` |
| `record_outcome` | `outcomeRecord` |

The map is exhaustive over the union so a transition added later cannot silently opt out of the
guard.

This is deliberately *narrower* than "the snapshot changed": a transition must move its **own**
dimension, so unrelated churn elsewhere in the snapshot — a shipped record landing, a label
appearing — cannot mask a stalled stage.

`judge_pr_prose` is the one transition whose dimension it does not itself write: the judge renders a
verdict, and only an `accepted` verdict legitimately leaves `pr.prose` unchanged *because it was
already accepted*. The guard is therefore evaluated against the post-effect observation, where an
`accepted` verdict on a PR that still observes as `halt` is exactly the contradiction Cycle B
walks — and is reported as one.

**Approach C from the review — deterministic halt-PR detection — is adopted as an application of an
existing decision, not as a new one.** `adr-2026-08-09-one-pr-per-branch-halt-is-a-state` already
establishes that a HALT is a *state* carried on the single per-branch PR, marked by the
`needs-remediation` label and the `<!-- conductor:needs-remediation -->` body marker. It follows
directly that the coordinator must *read* that state rather than pay a provider session to have an
LLM judge it. The observer therefore requests `labels` in its existing `gh pr view --json` call
(`finish-publication-production.ts:233`) and classifies halt through the existing four-signal
predicate `hasHaltSignal` (`halt-pr-rehabilitation.ts:500-505`) — title prefix, label, banner
sentinel, or body marker — rather than the two-signal test `prProse` uses today. A PR in the halt
state resolves `human_required` before any judgment is dispatched. No new ADR is warranted for
applying a governing decision to a second reader.

The bounded progress allowance from `adr-2026-08-06-bounded-progress-allowance-for-finish-publication`
is **retained unchanged**. It remains the backstop that discharges the termination obligation for
any advance the guard legitimately admits; this decision only ensures it is no longer the mechanism
that catches a stuck transition first.

## Consequences

### Positive

- Non-advancing publication retries become unrepresentable rather than merely bounded. The
  guarantee holds for transitions that do not exist yet.
- The halt an operator reads names the stage that actually ran and the dimension that did not move,
  which is actionable without reading engine source — the third desired outcome of #1487.
- A halt-state PR costs zero provider sessions and zero attempts at FINISH.
- Judge/observer disagreement surfaces as a defect at the point it occurs instead of being laundered
  into a retry.
- The existing progress allowance and retry budget stop absorbing loops they were never meant to
  catch, so an allowance-exhausted halt regains its original meaning: a genuinely long but healthy
  publication run.

### Negative

- The dimension map is a new correctness-critical table. A wrong entry is a false halt on a healthy
  run — the failure mode the bounded-progress ADR explicitly warned about when it rejected a naive
  "each transition progresses at most once" bound. Mitigated by mapping to the snapshot slice the
  transition writes rather than to a visit count, so a legitimate revisit (`establish_pr` re-running
  after `write_shipped_record` leaves the branch unpushed) still moves its dimension and still
  advances.
- One more `HumanRequiredReason` member, one more guidance-table row, and a halt vocabulary that
  operators and the runbook must learn.
- The guard runs on every transition, including the six that have never exhibited this defect.

### Follow-up Actions

- [ ] Extend `PublicationTransition` handling with the total dimension map and evaluate the guard on
      the re-observation `advanceFinishPublication` already performs.
- [ ] Apply the retry-path rule from the 2026-08-13 amendment: a `publication_retry` naming a
      transition the fresh observation would not select resolves `human_required`.
- [ ] Add the `HumanRequiredReason` member with its guidance entry (`finish-publication.ts:469-510`).
- [ ] Add `labels` to `observePullRequest`'s `gh pr view --json` field list and route halt
      classification through `hasHaltSignal`.
- [ ] Resolve a halt-state PR to `human_required` before judgment dispatch.
- [ ] Correct `docs/explanation/gates.md:265`, which still states the progress allowance as 12. The
      allowance is `2 × 7 = 14` (`finish-publication.ts:348`); the ADR text that says twelve was
      written when there were six transitions and is append-only history, not a live figure.
      `docs/runbooks/stalled-or-stuck-feature.md:269` already says 14.
