**Status:** Accepted

# Stories: Recoverable gate verdicts (#2067)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the durable record of every computed gate verdict and the operator-visible statement of that verdict in both renderers. Renaming the audit gate and rewording a gate report's own summary line remain outside this slice.

## Story 1: Recover any gate's verdict from the run's event ledger

As an operator reviewing a finished lap, I want every gate's computed verdict on the run's event ledger so that I can answer which gate passed, and on what basis, without reopening a per-gate report artifact that re-dispatch may already have swept.

### Acceptance Criteria

#### Happy Path

- Given a run computes a gate's objective verdict, when the run appends its events, then the run's persisted event ledger carries a gate-verdict record naming that step, its satisfied flag, and its reason.
- Given an auto-mode run dispatches the SHIP validation group and joins it, when each dispatched member's objective verdict is computed at that join, then the ledger carries one gate-verdict record per dispatched member, including the PRD-audit member.

#### Negative Paths

- Given the join replaces the PRD-audit member's computed verdict with the accepted-risk route result, when that member's verdict is recorded, then the record carries the verdict the join acted on rather than the superseded one.
- Given a dispatched member's branch does not return a passing dispatch outcome, when the group settles, then no gate-verdict record is written for that member.

### Done When

- [ ] The persisted-event contract enumerates the gate-verdict type, and a persister fixture writes a satisfied and an unsatisfied verdict as ledger records carrying step, satisfied, and reason.
- [ ] An auto-mode group-join integration fixture observes one ledger record per dispatched validation-group member, including the PRD-audit member.
- [ ] The recorded PRD-audit verdict equals the verdict the join acted on in an accepted-risk override fixture, and a member whose dispatch does not pass produces no record.

## Story 2: Read a gate's verdict off the log without inferring it

As an operator watching a running feature, I want a gate's pass stated in the log so that I do not have to read a pass out of four other signals or out of the absence of a kickback.

### Acceptance Criteria

#### Happy Path

- Given a gate's verdict is satisfied, when the daemon log renders that event, then it emits one line naming the step, stating the verdict as satisfied, and carrying the verdict's reason when one is present.
- Given a gate's verdict is satisfied, when the interactive terminal renderer renders that event, then it emits one line naming the step and stating the verdict as satisfied.
- Given a step's provider-completion marker and that step's satisfied gate verdict are both rendered, when an operator reads the two lines, then only the provider-completion line carries the provider-completion check glyph and only the verdict line states a gate verdict.

#### Negative Paths

- Given a satisfied verdict carries no reason, when either renderer renders it, then the line states the verdict and ends without a trailing separator or an empty reason.
- Given an unsatisfied verdict, when the daemon log renders it, then the existing unsatisfied line is unchanged and the kickback anchor text still appears on no line but a kickback line.

### Done When

- [ ] Both renderers emit exactly one line for a satisfied verdict, naming the step and the satisfied verdict, and including the reason when present.
- [ ] A rendered satisfied-verdict line contains no provider-completion check glyph, and a rendered provider-completion line states no gate verdict.
- [ ] A reasonless satisfied verdict renders with no trailing separator, the unsatisfied line keeps its current text, and the kickback anchor remains unique to kickback lines across the rendered event samples.

## Negative-category review

Invalid input, authentication, timeout, resource-exhaustion, concurrency, and cascade-deletion categories do not apply: this change adds no input surface, no external call, no shared mutable state, and no deletion. The categories that do apply are covered above. Partial failure and data integrity: the join can supersede a computed member verdict, so the recorded value must be the one the join acted on, and a member with no verdict must produce no record rather than a fabricated pass. Invariant side-effect on an alternate branch is the defect's own shape and is covered by Story 1: the serial walk emits a verdict event while the group-join branch computes the same verdict and emits nothing, which is exactly why the PRD-audit gate has no verdict anywhere today. Rendering integrity: a reasonless verdict and the preserved unsatisfied wording cover the formatting edges, and the kickback-anchor uniqueness check guards the greppable log contract that other tooling reads.
