# ADR: A step-runner failure whose inputs cannot change routes instead of retrying

**Date:** 2026-08-19
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session for ai-conductor#1729

## Context

Both features stranded on 2026-08-19 spent their entire `build_review` retry budget on a failure that
could not change between attempts. From `.daemon/daemon.log`, three tries in four seconds with no
suite launch between them:

```
· ↻ build_review retry (try 2/3: build_review input assembly failed: build_review requires CURRENT test_suite proof (got STALE))
· ↻ build_review retry (try 3/3: build_review input assembly failed: build_review requires CURRENT test_suite proof (got STALE))
· ✗ build_review failed (try 3): build_review input assembly failed: ...
· ✋ loop halted: step 'build_review' failed in auto mode (retries exhausted)
```

`TestSuiteProofError` is raised during input assembly (`build-review-inputs.ts:186`), before any
provider dispatch. The inputs it reads are the aggregate proof and the tree; nothing in a re-dispatch
of `build_review` can alter either, because the step that could is its own prerequisite
(`steps.ts:181`). The terminal message names neither the unchanged input nor the step that must
re-run.

`adr-2026-07-13-retry-classify-rerun-vs-route` built precisely this classifier. Its signal (b),
`identical-repeat`, is this failure's shape exactly: `attempt >= 2` and a byte-identical prior reason
and unchanged inputs. But D3 wired the classifier at the **completion-gate-miss** seam
(`conductor.ts:6884`), reading a `routeClass` facet off `CompletionResult`. A step **runner** that
returns `{success: false, output}` never reaches that seam; it falls to the unconditional retry
branch at `conductor.ts:6729`, which consults only `attempt < stepMaxRetries`.

`adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` D1 settled the discipline for exactly
this kind of extension: "Mechanical faults route on **result kind**, never on reason text… No routing
decision in this ADR reads `detail`, and no `detail` prefix match survives." A `startsWith` on
`'build_review input assembly failed'` would be the anti-pattern that ADR removed one day earlier.

## Options Considered

### Option A: Extend the existing classifier to the step-runner seam, keyed on a typed result facet (CHOSEN)

The step-runner failure result carries a machine-readable facet naming the failure as unretryable and
naming the step that must re-run. `classifyRetryDecision` gains that facet as a route signal and is
called at the step-runner failure branch before the budget is consulted.

- **Pros:** one classifier, one vocabulary, one kill switch (`retry_routing.enabled`, which
  `adr-2026-07-13` D6 defines as an exact revert); routes on kind, satisfying `adr-2026-08-18` D1;
  the halt can name the blocking step because the facet carries it; generalizes to every future
  deterministic input-assembly failure without another mechanism.
- **Cons:** the facet must be threaded from the throw site through the runner's catch to the result,
  which touches the `StepRunResult` shape; a failure that forgets to set it degrades to today's
  behavior (retry then halt) rather than to a wrong answer.

### Option B: Match the reason string at the retry branch

- **Rejected** on `adr-2026-08-18` D1, which replaced the one surviving prefix match in this codebase
  with a kind check and stated the rule generally. A prose match also breaks silently when the message
  is reworded, which is how the `startsWith` at `step-runners.ts:1830` decayed.

### Option C: Set `stepMaxRetries = 1` for `build_review`

- **Rejected.** It saves two dispatches on this failure and removes two legitimate retries from every
  transient one. It also leaves the halt message generic, so outcome-3 is unmet.

### Option D: A new terminal-failure mechanism separate from the classifier

- **Rejected.** `adr-2026-07-13`'s Non-goals name "no new routing mechanism — reuse
  `planRemediation`/kickback", and a second classifier would owe its own kill switch, telemetry arm,
  and interaction rules with the first.

## Decision

Adopt **Option A**.

### D1 — Unretryability is a typed facet on the step result, set at the throw site's boundary

The step-runner result gains an optional facet declaring that this failure's inputs cannot change on
a re-dispatch of this step, and naming the step whose completion would change them. It is populated
where the typed error is caught — `TestSuiteProofError` is already a named class
(`build-review-inputs.ts:184`), so the discrimination is a class check, not a text match. No routing
decision reads the message; the message continues to travel for the human report.

### D2 — The classifier gains the facet as a route signal, at the step-runner seam

`classifyRetryDecision` gains signal **(c) unretryable-inputs**: the result carries D1's facet.
Unlike signal (b) it fires on try 1, because unchangeability is asserted by the failure's own type
rather than inferred from a repeat. Signals (a) and (b) are unchanged, and the classifier stays pure
and LLM-free per `adr-2026-07-13`'s Non-goals.

### D3 — The route is the halt, and the halt names the step

An unretryable step-runner failure does not fall through to `planRemediation`: there is no gap to
remediate and no agent that can act. It terminates the loop with a `needs-human` halt whose reason
names the failing step, the unchanged input, and the step that must re-run — discharging
`adr-2026-07-13` D5's rule that a route dead-ending in a HALT names the unchanged input rather than
saying "retries exhausted".

`needs-human`, chosen not defaulted, for the reason `adr-2026-08-18` D5 records: `daemon-rekick.ts`
clears and re-dispatches `mechanical` halts on every sweep, and a halt the daemon auto-clears is not
a guard. `adr-2026-07-28-total-halt-classification-legacy-boundary` permits only `needs-human` or
`mechanical` for a new writer and requires `needs-human` where retry safety is not mechanically
provable.

**This is the residual path, not the common one.** With `adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch`
in force, a stale proof is resolved by re-dispatching `test_suite` and this halt is not reached. D3
governs the case where the proof is stale for a reason the loop genuinely cannot resolve — which is
precisely what outcome-3 asks for, and why both changes are in scope rather than one.

### D4 — The kill switch is the existing one

`retry_routing.enabled: false` (`adr-2026-07-13` D6) bypasses signal (c) exactly as it bypasses (a)
and (b), restoring today's unconditional retry. No new config key.

### D5 — The decision rides the existing telemetry arm

Signal (c) is emitted through `adr-2026-07-13` D4's `retry_decision` event, extending its `signal`
vocabulary. No new event member, so `adr-2026-07-26-event-sink-registry-exhaustiveness` obliges no
new sink declaration, and the existing pairing of `retry_decision` with the subsequent outcome event
continues to yield the rerun-vs-route success measurement that ADR was built to produce.

### D6 — `build` remains outside the classifier

`adr-2026-07-13`'s Non-goals exclude `build` from the classifier entirely and leave its retry and
progress accounting to #280. Unchanged.

## Consequences

### Positive

- A deterministic input-assembly failure costs one dispatch instead of three (outcome-4), and the
  saving generalizes to every future failure that adopts D1's facet.
- The terminal message names the step that must re-run (outcome-3), so an operator reading
  `.daemon/daemon.log` learns the cause without opening `.pipeline/`.
- `adr-2026-08-18` D1's route-on-kind discipline is applied rather than re-litigated, and no prefix
  match is introduced.

### Negative

- `StepRunResult` gains a field, and every runner that could raise a deterministic input failure has
  to opt in for the saving to apply there. Non-adoption is safe — it degrades to today's retry — but
  it is silent, so the coverage is only as wide as the facets actually set.
- Signal (c) fires on try 1, so a failure wrongly typed as unretryable loses its retries outright.
  The mitigation is that D1 keys on an error class rather than a heuristic, and the classifier's
  existing kill switch reverts the behavior wholesale.
