# ADR: Operator-authorized kickback budget recovery is a staged ledger decision consumed by daemon resume

**Date:** 2026-08-29
**Status:** Superseded by `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class`
**Deciders:** James Stoup (operator) and architecture review for jstoup111/ai-conductor#1760
**Extends:** `adr-2026-08-12-cumulative-build-review-convergence-bound`,
`adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence`,
`adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane`,
`adr-2026-08-13-stable-build-review-finding-dispositions`, and
`adr-2026-08-19-operator-step-rewind-through-the-mutation-port`
**Supersedes:** `adr-2026-08-12-cumulative-build-review-convergence-bound` D3's fixed effective
threshold only for a feature carrying an explicit operator-authorized raise. Five remains the
default and every unadjusted feature behaves unchanged.

## Context

The cumulative `build_review` bound deliberately survives tree movement and PASS verdicts so a
feature cannot evade bounded termination by making churn. A rebase that actually invalidates the
gate is the only automatic credit. That design now terminates spins correctly, but a feature stays
barred when the review behavior that produced its earlier laps changes outside the feature tree.
Recovery requires hand-editing the kickback ledger.

The operator selected explicit intervention over automatic review-contract fingerprints or LLM
equivalence. The remaining architectural problem is not the arithmetic; it is committing one
operator decision across durable budget state, an external-process event, a halt pair, daemon park
state, and the committed halt record without creating a race or a second channel.

Verified governing constraints:

- The kickback ledger is the existing feature-local durable control store and already writes by
  same-directory temporary file plus rename.
- The standalone CLI is a separate process. Approved operator review decisions use the existing
  external same-schema event ledger and merged reader rather than appending to the engine writer.
- An operator park blocks every future dispatch entry point, but an already-running scheduling unit
  settles before the park boundary takes effect.
- The cumulative-cap terminal occurs after the conductor has closed its execution window; its halt
  and park state therefore provide a quiescent recovery boundary when joined with a ledger lease.
- Clearing a halt also resolves committed halt presentation. Bypassing the daemon-owned resume seam
  would leave those surfaces inconsistent.

## Options Considered

### Option A: CLI mutates the ledger and directly clears the halt

- **Pros:** One synchronous command appears to complete recovery immediately; resembles operator
  rewind.
- **Cons:** The decision crosses ledger, external event, halt pair, park state, and committed halt
  presentation. No filesystem primitive commits those records atomically, and rollback cannot
  retract an event already appended. Direct clearing also duplicates daemon resume ownership.

### Option B: Staged adjustment in the existing ledger; daemon consumes resume authorization

- **Pros:** The operator decision commits inside one leased control store; crash recovery is
  explicit; the existing event writer carries the occurrence; the daemon remains the sole owner of
  clearing and presenting a resumed halt. Park state makes every incomplete phase fail closed.
- **Cons:** Recovery is a handoff rather than one multi-file transaction. A pre-existing operator
  park remains in force and needs an explicit unpark. The ledger gains a small staged state machine.

### Option C: Derive adjusted budget state from the event ledger

- **Pros:** One append would be both audit and authority.
- **Cons:** `adr-2026-08-12` already rejects telemetry-ledger parsing as a control dependency; one
  malformed record could disable or corrupt convergence decisions. It confuses occurrence with
  durable state.

## Decision

Choose **Option B**.

### D1 — Extend the existing gate entry; add no second control store

`KickbackGateEntry` remains authoritative and gains an optional feature-local effective cumulative
limit, attributed adjustment history, typed cumulative-cap halt evidence, an optional staged
adjustment, and an optional resume authorization. Missing fields normalize to today's behavior:
effective limit 5, no history, no pending work, and no authorization.

The typed cap evidence carries the gate, consumed count, effective limit, latest semantic reason,
and a stable halt generation. It is written before the human halt. Recovery requires that evidence,
the current ledger values, and `HALT.class = kickback-cap` to agree; prose matching never authorizes
mutation.

All kickback-ledger read-modify-write operations, including conductor consumption, rebase credit,
mechanical allowance, and operator adjustment, serialize through one bounded feature-local lease
using the existing conduct-state lease primitive with a kickback-ledger label. A live or ambiguous
owner fails closed.

### D2 — Reset changes consumption; raise changes only the effective limit

- `reset` sets `cumulative` to zero and preserves the feature's effective limit.
- `raise --by N` preserves `cumulative` and increases the effective limit by positive safe integer
  `N`.
- Neither operation changes `count`, `mechanicalFaults`, `lastMechanicalFault`, repository config,
  or another gate/feature.
- Rebase invalidation continues to credit lap-counting fields. Effective limit, adjustment history,
  pending state, halt evidence, and resume authorization are explicitly non-lap-counting and survive
  that credit. A genuinely fresh feature session still clears the entire ledger and returns to the
  default.

Repeated raises are allowed because each is an explicit operator decision with attribution. The
bound remains active at the resulting effective limit; another raise requires another exhausted
halt and another recorded decision.

### D3 — The public interface is one named, operator-only command family

The stable callable interface is:

```text
ai-conductor kickback-budget inspect --feature «slug» [--format json]
ai-conductor kickback-budget reset --feature «slug» --rationale «text»
ai-conductor kickback-budget raise --feature «slug» --by «positive-integer» --rationale «text»
```

`inspect` is read-only and may run without a TTY. Mutating actions require an interactive TTY,
machine-scoped operator identity through the approved user-config then GitHub chain, one exact
feature, a non-empty bounded rationale, and valid numeric input. Unattended harness/provider
processes cannot invoke the authority path. Every refusal leaves active budget state unchanged.

Feature resolution reuses the named-worktree behavior already used by `build-review` operator
commands, factored into a shared module rather than copied.

### D4 — The command establishes and preserves quiescence

Before a mutating action, the command resolves the main repository and ensures an operator park for
the exact slug. If it creates the park, it owns that temporary park and releases it only after the
adjustment is fully committed and observable. If the park already existed, it preserves it and
prints the existing unpark action instead of assuming ownership.

The exact cumulative-cap halt proves the conductor reached its terminal boundary. The park prevents
new dispatch; the kickback-ledger lease serializes against any last in-flight ledger writer. A
missing/mismatched halt, unclassified or different halt class, unresolved feature, lost lease, or
changed ledger snapshot refuses toward parked/halted.

### D5 — A staged adjustment is the crash-recovery journal

Under the ledger lease, the command writes a `pendingAdjustment` with a unique adjustment id, kind,
before/after count and limit, operator, rationale, timestamp, and matching halt generation. Active
budget fields remain unchanged at this phase.

The external event writer appends one same-schema operator-authorization occurrence keyed by the
adjustment id. Its writer lock and idempotency check make retry exactly-once for that id. After the
append succeeds, the command reacquires/verifies the ledger lease and atomically:

1. applies the before/after values;
2. moves the staged record into durable adjustment history;
3. installs resume authorization bound to the adjustment id and halt generation; and
4. removes the pending record and typed exhausted state.

If append fails, active fields remain unchanged and the pending record is removed when safe. After a
crash, command-entry reconciliation checks the explicit adjustment id: a matching external event
finishes the apply; an absent event discards the pending record; unreadable or ambiguous event state
keeps the feature parked/halted. Normal engine control never derives counts from events.

### D6 — The daemon, not the CLI, clears the halt

A successful operator action authorizes resume but does not delete the halt pair directly. When the
temporary park is released—or when the operator later removes a pre-existing park—the daemon's
normal halted-feature path validates the resume authorization against the live `kickback-cap` halt,
clears the halt through the existing atomic marker/presentation lifecycle, emits the existing
halt-clear evidence, consumes the authorization, and resumes normal selection.

If halt clearing or presentation repair fails, the feature stays halted. If the halt disappeared or
changed before consumption, the authorization is refused as stale and no unrelated halt is cleared.
The command never dispatches, builds, merges, or bypasses another gate.

### D7 — Adjustment authorization rides the existing event spine

Add a typed `kickback_budget_adjustment_authorized` `ConductorEvent` carrying adjustment id, feature,
gate, kind, before/after count and limit, operator, rationale, and timestamp. Because the CLI is an
external process, it writes through the existing same-schema sibling ledger and merged reader
(event-spine exceptions A/B); live engine consumers tail and re-emit it without re-persisting.

Current count, limit, history, staged state, and resume authorization are durable control state
(exception C). No new event file, bespoke audit schema, watcher, or timestamp-in-artifact channel is
introduced.

### D8 — One renderer owns inspection and exhaustion diagnostics

A pure budget-view renderer derives count, effective limit, remaining allowance, latest semantic
reason, adjustment history, and separately excluded mechanical-fault state from the gate entry. Both
read-only inspection and the cumulative-cap halt use that view so they cannot drift.

Legacy entries remain inspectable: current count and default limit are authoritative; absent
adjustment or older-lap detail is explicitly reported unavailable. History is never invented from
reason text or inferred from timestamps.

## Event-Spine Verdict

```text
Event spine
  Channel?    yes — operator budget authorization is an occurrence
  Concern:    occurrence for authorization; durable state for budget and resume authority
  Verdict:    same ConductorEvent schema through the existing sibling ledger and merged reader
  Exception:  A/B for the standalone CLI writer; C for kickback-ledger control state
```

## Claim and Assumption Ledger

### Verified claims

- [verified] The cumulative cap increments outside tree-progress reset and has no operator adjustment
  command in current CLI/source/docs.
- [verified] Rebase invalidation is the only current convergence-lap credit; PASS does not clear it.
- [verified] Mechanical faults have a separately bounded lane and do not consume semantic
  cumulative budget.
- [verified] The existing external event writer carries `ConductorEvent` schema from standalone
  operator commands and the merged reader/tailer already exists.
- [verified] Operator park is rechecked before every future dispatch and fails toward parked.
- [verified] The ledger's current writer is atomic per file but not leased across read-modify-write;
  the reusable conduct-state lease primitive exists.
- [verified] Daemon halt clear owns committed halt-record resolution, so direct CLI deletion would
  bypass an approved lifecycle.

### Approved assumptions

- [operator-approved 2026-08-29] The operator is the authority for declaring previous semantic laps
  obsolete or granting a larger one-feature allowance.
- [operator-approved 2026-08-29] Full remaining #1760 outcomes are in scope; mechanical-fault
  classification remains unchanged.

No unconfirmed load-bearing assumption remains. The operator's approval of this ADR confirms D2's
reset/raise persistence, D3's public grammar, D4's park ownership, and D6's daemon handoff.

## Consequences

### Positive

- Recovery replaces unleased state surgery with a guarded, attributable operator decision.
- Crash windows are explicit and recoverable; none can make an incomplete action dispatchable.
- The unchanged-spin bound remains deterministic and active after every adjustment.
- Halt markers, committed halt records, daemon logs, audit consumers, and budget inspection converge
  through their existing owners.

### Negative

- The kickback ledger gains a lease and a small staged state machine.
- A crash can leave a feature safely parked with a pending adjustment that a later command must
  reconcile.
- An operator may repeatedly raise one feature's allowance; auditability and repeated explicit
  authority mitigate but do not eliminate that human risk.
- Existing #497 worktree-loss behavior also loses local adjustment history. This remains fail-open
  and is not widened into cross-worktree state by this feature.

### Follow-up Actions

- [ ] Implement leased, backward-compatible kickback-ledger adjustment state and pure budget view.
- [ ] Add the operator-only command family, shared feature resolver, authority/refusal checks, and
  temporary-park ownership behavior.
- [ ] Add idempotent staged adjustment reconciliation and daemon resume-authorization consumption.
- [ ] Add the event member, external writer allowlist, merged-reader coverage, audit mapping, and
  daemon rendering.
- [ ] Update CLI, gate, artifact, daemon, and stuck-feature recovery documentation.
