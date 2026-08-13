# Coherence: Harden intake ledger durability (#1476)

**Date:** 2026-08-12
**Tier:** M (`.docs/complexity/harden-intake-ledger-durability.md`)
**Track:** technical — the `fr` row class is omitted as not applicable (no PRD, no enumerated
`FR-N`; acceptance criteria live in the stories).
**Outcome source:** `.pipeline/intake-outcomes.md`, 5 bullets, verified against
jstoup111/ai-conductor#1476's Desired-outcome section.
**ADR row pool:** the one non-deleted `.docs/decisions/adr-*.md` file in the current change set.
**Consistency pass (§4d):** run over every covered row across the outcome↔task, outcome↔story, and
ADR↔story layer pairs. No contradiction and no oscillation found; the two cross-layer tensions that
existed were resolved during conflict-check and are noted on the affected rows.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-2, story-7 | covered | "Never treated as an empty ledger, and never overwritten." story-2 pins refusal plus a byte-identical file for all five mutators; story-7 extends refusal to the three read methods so no caller reads a corrupt ledger as empty. |
| outcome | outcome-2 | story-3 | covered | "Original bytes are still recoverable." story-3 requires a byte-equal quarantine copy and requires `ledger.json` itself to remain in place, so the bytes survive in two locations, not one. |
| outcome | outcome-3 | story-4, story-5 | covered | "Operator learns at the time it is encountered." story-4 covers the one-shot CLI verbs (stderr warning naming both paths, non-zero exit); story-5 covers the long-running loop, which is the caller that would otherwise absorb it. Episode suppression does not weaken this: the first encounter of any given corruption still warns immediately. |
| outcome | outcome-4 | story-6 | covered | "With N processes each adding a distinct entry, all N entries are present afterward." story-6's happy path states exactly this property, and task-15 exercises it against real concurrent processes rather than stubs. |
| outcome | outcome-5 | story-1 | covered | "A legitimately absent ledger still starts empty with no warning and no error." story-1's negative paths explicitly forbid a quarantine file and forbid warning text on the absent branch, so hardening cannot leak into first-run. |
| story | story-1 | task-2 | covered | task-2's test description was extended during the plan's coverage cross-check to name story-1's `{}`-is-valid, no-quarantine-on-absent, and non-ENOENT-read-failure criteria explicitly. |
| story | story-2 | task-1, task-3, task-9, task-10 | covered | task-1 the typed error, task-3 the valid-JSON-non-store case, task-9 the per-method refusal with a byte-identical file, task-10 the temp-residue and repair-then-retry criteria. |
| story | story-3 | task-4, task-5, task-6 | covered | task-4 copy-not-rename, task-5 the once-per-episode reuse resolved in conflict-check A, task-6 the unwritable-directory case where quarantine failure must not mask corruption. |
| story | story-4 | task-16 | covered | task-16 names all four of story-4's Done-When items: stderr content, non-zero exit, no success-shaped stdout payload, and no ledger content in the message. |
| story | story-5 | task-17, task-18 | covered | task-17 narrows the `loop.ts:258-267` catch and moves the enqueue behind a successful record; task-18 adds episode-scoped reporting, the dispatch hold, and resume-after-repair. |
| story | story-6 | task-8, task-12, task-13, task-15 | covered | task-8 the wrapper itself, task-12 fail-closed on an unacquirable lease, task-13 dead-owner recovery and live-owner timeout naming the pid, task-15 the multi-process additive proof. |
| story | story-7 | task-11, task-12 | covered | task-11's test description was extended during the plan cross-check to cover story-7's wait-rather-than-fail and complete-state-never-a-mixture criteria; task-12 covers lease-timeout on a read. |
| story | story-8 | task-7 | covered | task-7 covers both directions story-8 requires: a labelled lease names the intake ledger, and an unlabelled one keeps today's conduct-state wording so the existing consumer does not regress. |
| story | story-9 | task-14 | covered | task-14's test description was extended during the plan cross-check to cover the missing-directory-created and empty-env-var-falls-back criteria alongside path derivation and cross-directory non-contention. |
| task | task-1 | story-2 | covered | Typed `CorruptLedgerError` — the mechanism by which refusal propagates instead of collapsing to an empty store. |
| task | task-2 | story-1 | covered | Absent-versus-unreadable discrimination; the load-path branch story-1 depends on. |
| task | task-3 | story-2 | covered | Valid-JSON-non-store rejection. Load-bearing: `JSON.parse('[]')` succeeds and would otherwise persist as an empty store — the wipe by a second route. |
| task | task-4 | story-3 | covered | Quarantine by copy, leaving `ledger.json` in place. |
| task | task-5 | story-3 | covered | Episode keying, implementing conflict-check resolution A. |
| task | task-6 | story-3 | covered | Quarantine failure reported without masking the corruption. |
| task | task-7 | story-8 | covered | Optional store label on the shared lease primitive. |
| task | task-8 | story-6 | covered | The `withLedgerLease` wrapper; the single point every other lease-dependent task builds on. |
| task | task-9 | story-2 | covered | Routes the five mutating methods through the wrapper so `saveStore` is structurally unreachable on the corrupt path. |
| task | task-10 | story-2 | covered | No temp-file residue after a refused mutation; repair-then-retry succeeds cleanly. |
| task | task-11 | story-7 | covered | Routes the three read methods through the wrapper. |
| task | task-12 | story-6 | covered | Fail closed when the lease cannot be acquired, for both reads and mutations. |
| task | task-13 | story-6 | covered | Stale-owner recovery and live-owner timeout diagnostics. |
| task | task-14 | story-9 | covered | Lease and quarantine paths derived from the ledger path. |
| task | task-15 | story-6 | covered | Multi-process additive proof. Expected to require no new production code; carries a real acceptance test rather than a verify-only exemption because the property is only meaningful against real concurrent processes. |
| task | task-16 | story-4 | covered | Corrupt-ledger surfacing on the failing CLI verb. |
| task | task-17 | story-5 | covered | Narrows the intake loop's per-envelope catch so a corrupt ledger escapes it. |
| task | task-18 | story-5 | covered | Once-per-episode reporting plus the dispatch hold while the dedup authority is unreadable. |
| adr | adr-2026-08-12-fail-closed-intake-ledger-durability | story-1, story-2, story-3, story-4, story-5, story-6, story-7, story-9 | covered | Each decision clause has an implementing story: D1→story-1 and story-2, D2→story-2, D3→story-3, D4→story-4 and story-5, D5→story-6 and story-7, D6→story-9. D7 (the additive amendment to ADR-012's corrupt-ledger consequence) constrains rather than adds behavior and is honored by story-4, which requires the operator be told directly rather than relying on the GitHub label. story-8 is the only story with no ADR clause — it implements architecture-review Condition 2, not a decision clause, which is why it does not appear here. |

## Consistency pass detail (§4d)

Cross-layer pairs were tested in both directions. Same-layer story-versus-story pairs are
`/conflict-check`'s sweep and are not re-reported here.

- **outcome-3 ↔ task-18.** The one pair worth stating explicitly. outcome-3 requires the operator
  learn "at the time it is encountered"; task-18 suppresses repeat warnings within a corruption
  episode. Tested forward: fully satisfying outcome-3 on every poll would break task-18's bound —
  which is precisely the degradation conflict-check recorded as Conflict A. Tested backward:
  satisfying task-18 still delivers outcome-3, because the *first* encounter of any distinct
  corruption warns immediately and every refusing operation continues to fail loudly by exit code.
  One "no" and one "yes" is an ordinary resolved degradation, not an oscillation. **covered**, not
  `fail`.
- **outcome-5 ↔ story-7.** story-7 makes reads refuse on corruption; outcome-5 requires an absent
  ledger to stay silent. Both directions hold because the load discriminator (task-2) separates the
  two branches before either behavior applies. No contradiction.
- **outcome-1 ↔ task-15.** task-15 anticipates landing no new production code. That does not
  weaken outcome-1, which is delivered by tasks 3, 9, and 10; task-15 proves a different property
  (outcome-4). No contradiction.
- **ADR D5 ↔ story-6.** D5 requires reads to acquire the lease, which adds contention on the intake
  hot path against a machine-wide singleton ledger. Tested both directions: story-6's additive-write
  property still holds under read-locking, and story-7's torn-read property still holds under
  story-6's concurrency. This was conflict-check Conflict B, resolved by the operator in favor of
  acquiring; the accepted cost is recorded in story-7's contention note. No contradiction remains.

## Assumptions surfaced

None outstanding. Every `covered` verdict above was confirmed by reading the counterpart artifact
file in this change set rather than inferred from a plausible id match. The two ambiguities that
arose during DECIDE — quarantine frequency and read-path locking — were both put to the operator
and explicitly decided before this artifact was authored, so no row rests on an unconfirmed
load-bearing assumption.
