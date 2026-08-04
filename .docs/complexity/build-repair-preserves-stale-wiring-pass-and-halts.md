# Complexity: build-repair-preserves-stale-wiring-pass-and-halts

Tier: M

Rationale: a correctness fix spanning three existing engine seams — the deterministic
BUILD-verification kickback branches (`conductor.ts:3722-3737`), member reuse at the group engagement
site (`conductor.ts:3328`, `:7942-7987`), and `advanceTail`'s tail selection (`conductor.ts:7352-7390`,
applying the existing `clampToRunnablePrerequisite`) — plus per-member settle-decision events, their
daemon.log rendering, amendments to two accepted assertions, and the canonical documentation.

No new models, integrations, auth, or state machines, and no new subsystem, persisted field, or
configuration key: the concurrent group core, the two satisfaction predicates, the runnable-prerequisite
clamp, the event-sink registry, and both members' code-state-anchored evidence all already exist and are
consumed rather than extended. Moderate story count (5) with adversarial negative paths on both sides —
a member the repair invalidated must be re-verified, and a member it could not affect must not redo its
work or charge budget.

Not S because this changes gate-satisfaction semantics: `stepSatisfied` is consulted by every gate, so
the tail-selection change is a shared-invariant change that needs conflict-check plus an architecture
review, and the conflict scan did surface two accepted assertions requiring amendment. Not L because
every change lands inside an existing seam, the correctness argument is local to one phase's join, and
the chosen design removes an authority rather than adding one.
