---
Status: APPROVED
Date: 2026-08-09
Deciders: operator (James Stoup)
Feature: acceptance_specs RED evidence visibility and provenance (#1246)
---

# ADR: Acceptance-RED lifecycle on the event spine, with provenance-bearing evidence

## Status
APPROVED

## Relates to
`adr-2026-07-21-engine-owned-acceptance-red-execution` — **relied upon, not superseded.** That ADR
established engine-owned RED execution driven by a skill-recorded run contract, and its self-heal
seam is the mechanism this ADR's backward-compatibility path depends on. Nothing in its decision is
reversed here: the gate's pass bar (`errors == 0`, `skipped == 0`, `executed >= 1`, `failed >= 1`,
`artifacts.ts:1276-1299`) is unchanged, the completion predicate stays a pure read
(`artifacts.ts:2041`), and execution stays out of the predicate.

## Context

The `acceptance_specs` step is correct and silent. Both properties are load-bearing to the problem.

**Correct.** `validateAcceptanceRedEvidence` (`artifacts.ts:1245-1301`) already refuses to pass a
run that errored at collection, was skipped, executed nothing, or shows `failed == 0`. A green
acceptance suite genuinely cannot satisfy the gate today. The reported incident is therefore not a
gate hole.

**Silent.** `grep acceptance src/conductor/src/types/events.ts` returns zero matches (verified,
2026-08-09). The entire RED lifecycle — required, attempted, self-healed, accepted, refused — emits
nothing on the `ConductorEvent` spine. The only live per-step operator surface is
`daemon-dashboard.ts:753`, which renders slug, tier, step and heartbeat age and nothing else. The
engine computes a precise `CompletionResult.reason` string for every unsatisfied gate
(`artifacts.ts:752`) and injects it into the retry prompt, then discards it from the operator's view.

The consequence, observed on the run that produced #1246: an operator watching a step that had
already produced a passing suite could not tell whether RED evidence was required, captured,
relevant, or absent, and could not tell active work from a wait on an unmet completion condition.
Deciding to wait, park, or intervene was guesswork, and an unattended session burned capacity while
providing no evidence the specs ever failed for the intended reason.

A second, quieter defect sits inside the evidence itself. The marker records counters, a command,
and a spec list. It cannot say *which* test failed, *why*, *when* it ran, or why that failure
corresponds to the behavior the feature is supposed to add. `failed >= 1` is satisfied equally well
by a spec that fails because the feature is missing and by a spec that fails because it was written
against the wrong import path. The gate cannot distinguish them, and neither can a reviewer reading
the marker afterwards.

### Assumptions surfaced

| Assumption | Confidence | Basis | Impact if wrong |
|---|---|---|---|
| No `ConductorEvent` variant covers acceptance RED today | 99% | verified — grep returns zero matches | If a variant existed, this would be an emit-site change, not a union change |
| `CompletionResult.reason` is computed for every unsatisfied acceptance gate and is absent from the dashboard | 95% | verified — `artifacts.ts:752` defines it, `daemon-dashboard.ts` never reads it | If the dashboard already surfaced it, part 3 shrinks to formatting |
| `selfHealAcceptanceRed` runs when the marker is invalid, not only when it is missing | 95% | verified — `conductor.ts:5311-5343` guards on missing **or** invalid with specs committed | The back-compat path below would not fire, and legacy markers would hard-fail |
| A valid run contract is present whenever a legacy marker is | 60% | inferred — the skill writes both, but a marker can outlive a contract across worktree recreation | The re-run path degrades to today's "run contract missing" failure, which is not a new failure mode |

The fourth assumption is deliberately not resolved by this ADR. Its failure mode is
indistinguishable from current behavior, so it cannot regress anything; it is recorded here so the
residual risk is stated rather than discovered.

## Decision

**1. Extend the `ConductorEvent` union with an `acceptance_red` variant.** It carries a `state` of
`required | pending | satisfied | rejected`, the step, the gate `reason` when the state is
`rejected`, failing-test detail when known, and a `viaException` flag (see
`adr-2026-08-09-recorded-red-exception-for-remediation`). Emit sites are the `acceptance_specs`
step path in `conductor.ts`, `acceptance-red-runner.ts` as the self-heal progresses, and the gate
verdict itself.

This rides `ConductorEventEmitter → EventPersister → .pipeline/events.jsonl` unchanged. The daemon
CLI, the UI renderer, the OTel visualizer and the event sinks all gain the signal with **no new
reader path**. Per `.agents/skills/event-spine/SKILL.md`, this is an occurrence in time and the bus
already carries the concern; the absence of a variant is the work, not evidence against the bus.

**2. Give the RED marker provenance.** Add `failingTests` (identity plus per-test failure reason),
`ranAt`, and `intentRationale` — a short statement of why the recorded failure corresponds to the
behavior the feature is missing. `validateAcceptanceRedEvidence` enforces their presence and
non-emptiness. The shipped `skills/writing-system-tests/SKILL.md` records them on the happy path
(§6, alongside the existing `summary` field it already writes but nothing validates); the engine
self-heal path produces them from the run it executes, so a self-healed marker is never weaker
evidence than a skill-authored one.

The marker is durable gate state read by name — event-spine exception C. Enriching it is not a
parallel channel. Nothing is stamped into it to stand in for an event: every field added here
answers "what is true about this run", and every occurrence is emitted separately on the bus.

**3. Report state, and the exact unmet condition, on the live surface.** The per-step line in
`daemon-dashboard.ts` distinguishes `working` — the heartbeat belongs to the current dispatch
(`heartbeatBelongsToDispatch`) and is fresh (`classifyHeartbeatAge`) — from `waiting`, where the
dispatch has returned but the completion gate has not passed. In the `waiting` state it prints the
completion predicate's own `reason` string. It also carries elapsed step time, heartbeat age, last
meaningful action, last test outcome, and the RED state from the ledger.

**4. Backward compatibility is re-run, never grandfathering and never a hard fail.** A marker
written by the current runner lacks the provenance fields, so the stricter validator reports it
invalid. That is precisely the condition `selfHealAcceptanceRed` already handles: the engine
re-executes the recorded run contract once per attempt and writes a fresh, provenance-bearing
marker at the authoritative root path. No in-flight build hard-fails. The cost is one extra spec
run per in-flight feature.

> **Amended 2026-08-09 by #1246:** the recovery seam does not reach a refused marker as this ADR
> originally assumed, so the decision now also requires widening the guard that gates it.
> Conflict-check verified that `conductor.ts:5326-5333` decides reachability by **substring-matching
> the completion reason** (`"… is missing"`, `"invalid JSON in …"`), not by asking whether the
> marker is valid. A legacy marker is well-formed JSON that the *validator* refuses — the predicate's
> third failure branch (`artifacts.ts:2042`) — whose reason matches neither substring. Left as-is,
> the re-run path never fires and the step re-dispatches the skill in print mode, the exact failure
> `adr-2026-07-21-engine-owned-acceptance-red-execution` exists to escape.
>
> The decision is therefore: the guard fires on a missing marker, unparseable JSON, and
> **shape-class** validator refusals (missing or empty provenance fields, missing
> `command`/`targetSpecs`, non-numeric counters), and does **not** fire on **outcome-class**
> refusals (`failed == 0`, `skipped > 0`, `errors > 0`), which report a real observed result that a
> re-run cannot change. This requires the validator to classify its own refusals so the guard can
> consume the class without re-parsing prose. Carried by Story 8.

The two rejected alternatives are recorded because both are locally cheaper:

- **Grandfather the new fields when absent.** Rejected: the validator cannot tell who wrote a file,
  so "required only for new writers" is unenforceable, and the gate would keep passing indefinitely
  on evidence that cannot name which test failed. That leaves the second defect above permanently
  unaddressed while appearing to fix it.
- **Hard-fail a legacy marker with a diagnostic.** Rejected: it interrupts every in-flight feature
  and demands per-feature operator action, while bypassing the seam that exists precisely to
  recover this case.

## Consequences

**Positive.** The RED lifecycle becomes visible to every existing spine consumer at once. A
reviewer reading a marker can tell which test failed, why, when, and why that failure is the
intended one. An operator can distinguish work from a wait and, when waiting, read the exact
unresolved condition rather than inferring it. Nothing new must be taught to any consumer, because
no new reader path exists.

**Negative.** In-flight features pay one extra acceptance run at their next `acceptance_specs`
attempt. `intentRationale` is authored judgement, so it can be filled in perfunctorily; the
validator can enforce presence and non-emptiness but not sincerity — this is an accepted limit, not
an oversight, and it is still strictly more than the zero rationale recorded today.

**Residual.** Where no valid run contract accompanies a legacy marker, the re-run path degrades to
today's "run contract missing" failure. This is the current behavior for that state, not a
regression introduced here.

## Out of scope

Subagent/child-count observation and any cached-versus-uncached token split are **not** delivered.
The provider layer configures subagents but never observes them (`claude-provider.ts:749-750`,
`llm-provider.ts:226`), and the only token fields on the union are the end-of-feature
`feature_usage_total` aggregate (`events.ts:183-184`). Both are deferred to
`jstoup111/ai-conductor#1441`. The status line must render `unknown` for child count rather than a
number it cannot compute — a fabricated zero would be worse than the silence it replaces.
