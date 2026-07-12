# Complexity: Progress-aware build halt (#280)

Tier: M

## Rationale

Medium. State-machine change to a critical, well-tested control path (the build retry loop in
`conductor.ts`), spanning two coordinated dimensions:

- **Within-dispatch:** make forward-progress delta the primary continue/halt signal in the retry
  loop; add an absolute attempt ceiling as a safety backstop.
- **Across-dispatch:** progress-gated re-kick so a build whose last dispatch resolved >=1 task is
  re-dispatched without a base advance (today `rekickSweep` fires only on a new origin/main sha),
  bounded by a per-spec dispatch ceiling.

Signals: multi-site edit (retry loop, daemon re-kick, config validation); interacts with
`daemon-auto-park` (checkAndAutoPark), durable `taskEvidence.noEvidenceAttempts`, and
`rekickSweep`; new config knobs with validation; a real state machine (retry -> park -> re-kick).
Negative/adversarial paths matter (slow-drip progress, corrupt task-status, re-kick storms).

Not Small: not a single-file trivial edit; conflict-check + architecture artifacts required.
Not Large: no new models/auth/integrations/subsystems; bounded, additive surface reusing existing
progress-counting primitives.
