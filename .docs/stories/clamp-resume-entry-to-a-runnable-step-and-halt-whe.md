**Status:** Accepted

# Stories: Clamp the resume entry to a runnable step (#1717)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the resume entry index and the terminal verdict a resume leaves behind. Kickback restaging policy, the downstream-stale cascade, `--from-step` navigation, and operator recovery tooling remain outside this slice.

## Story 1: Resume enters a step the loop can actually dispatch

As an operator whose feature was re-kicked, I want resume to enter the earliest step whose gate passes so that a re-opened build behind later resolved steps runs instead of wedging.

### Acceptance Criteria

#### Happy Path

- Given a resumed feature whose state-derived entry step is refused by its own entry gate while an earlier prerequisite is itself dispatchable, when the conductor resumes, then it dispatches that earlier prerequisite rather than ending the run with nothing dispatched.
- Given a resumed feature whose re-opened build sits behind later steps still recorded resolved, when the conductor resumes, then the first dispatched step is build.
- Given a resumed feature whose state-derived entry step's own gate already passes, when the conductor resumes, then it enters that same step and re-runs no earlier resolved step.

#### Negative Paths

- Given a resumed feature with no readable gate verdicts and an entry step its gate refuses, when the conductor resumes, then it reconciles the entry from step state alone and dispatches a step whose gate passes.
- Given a daemon resume whose reconciliation moves the entry back onto a DECIDE-phase step with no operator grant, when the conductor resumes, then it halts through the existing decide-entry disposition and dispatches nothing.

### Done When

- [ ] A resume fixture whose entry gate is refused while an earlier prerequisite is dispatchable reports that prerequisite as its first dispatched step.
- [ ] A resume fixture with satisfied gates ahead of a dispatchable entry enters the same step the pre-change derivation chose.
- [ ] A resume fixture with an unreadable verdict directory still dispatches a step instead of ending with zero dispatches.
- [ ] A daemon resume reconciled back onto an ungranted DECIDE step ends on the existing decide-entry halt text with no dispatch.

## Story 2: An undispatchable resume names the inconsistency

> **Amended 2026-09-07 (operator decision, as-built AB-1 on this feature):** the blocked outcome
> is prevented by construction. Every registry production can build preserves the
> earlier-prerequisite invariant, so the bounded backward walk always terminates on a step whose
> entry gate passes; a dedicated "blocked resume" halt branch is therefore an unreachable production
> rung and is removed. When the walk cannot improve the candidate, the resume enters that candidate
> and the loop's **existing** gate refusal owns the reporting (it already emits `gate_blocked` and
> writes the needs-human halt when every unsatisfied prerequisite is non-pending). No new halt path,
> outcome type, or marker text is introduced. The acceptance criteria and Done When below are
> narrowed accordingly; the two negative criteria are unchanged.


As an operator diagnosing a re-kicked feature, I want a resume that cannot derive a dispatchable entry to end with a terminal halt naming the blockage so that I get an instruction instead of an identical markerless park on every re-kick.

### Acceptance Criteria

#### Happy Path

- Given a resume whose entry gate is still unsatisfied after backward reconciliation, when the conductor resumes, then it enters that candidate step and the loop's existing entry-gate refusal reports the unsatisfied prerequisites through its existing `gate_blocked` event and needs-human halt; no resume-specific halt branch runs.
- Given that same resume, when the conductor resumes, then it dispatches no step before the loop's gate refusal and leaves no resume-specific marker of its own.

#### Negative Paths

- Given a resume whose reconciled entry gate passes, when the conductor resumes, then no halt marker is written for the entry decision.
- Given a resume whose derived entry is past the last step because the feature already converged, when the conductor resumes, then no halt marker is written and no step is dispatched.

### Done When

- [ ] The entry resolution is total: it returns the earliest dispatchable earlier prerequisite when one exists and otherwise the candidate itself; it has no blocked outcome type.
- [ ] No resume-specific blocked-halt helper, outcome type, or test fixture remains; a resume whose candidate gate still refuses is reported by the loop's existing gate refusal.
- [ ] A dispatchable resume fixture and a past-the-end resume fixture each leave no halt marker behind.

## Negative-category review

Invalid and unavailable input is covered by the unreadable-verdict path and by a resolved step list whose prerequisite cannot be located or resolves in a cycle — the two shapes that make backward reconciliation fail — both of which fail closed on a named halt rather than a silent exit. Authority and permission are covered by the daemon decide-entry disposition path, which keeps an ungranted DECIDE re-entry refused. Idempotency is covered by the requirement that a repeated re-kick of an undispatchable resume reaches the same terminal halt instead of an identical markerless park, and by the past-the-end resume that must stay a no-op. Partial-failure and rollback are inapplicable: entry resolution is a pure derivation over already-persisted state and writes no state. Concurrency, resource exhaustion, cascade deletion, and third-party dependency categories are inapplicable; the change adds no store, queue, network call, or deletion, and reads only files the resume path already reads.
