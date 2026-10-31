# ADR: An operator decision answers a stacked restack conflict, for feature-repair and base-refresh

**Date:** 2026-10-31
**Status:** APPROVED
**Deciders:** operator (James Stoup), composer session for #3478 (merged with #3460)

## Context

The restack resolver halts on a semantic ambiguity and names the missing decision. The rebase skill
tells it to (`step-runners.ts` `resolveRebaseConflict`). #3478 recorded two halts on the same
conflict in feature `build-review-re-raises-already-decided-findings-ev`. Between them the operator
answered with `halt clear --rationale`. The resolver never saw the answer and asked again. The only
way out was a hand-edited branch rewrite.

#3421 shipped as #3522 (`adr-2026-10-25-operator-recorded-restack-conflict-resolution`) and closed
part of that gap:

- **What it covers (verified).** A `feature-repair` conflict halt writes a durable conflict record
  and prints a recipe. The operator can then rebase on a scratch branch and record the result with
  `ai-conductor stack restack-resolve --tip`. The next restack consumes it, including for a closed
  child, with no hand edits to branches or `refs/conductor/*`.
- **Gap 1: no written answer (verified).** No channel carries a written answer into the resolver.
  `ResolutionContext` (`rebase.ts`) holds only the conflicts, the project root and the base ref.
  The tip path makes the operator do the rebase the resolver was asking for help with.
- **Gap 2: base-refresh dead-ends (verified).** A `base-refresh` conflict writes no record and no
  recipe. `haltRecordedRestackConflict` gates both on `cause === 'feature-repair'`, and consumption
  is gated the same way in `runRestack` and `resumePlanned`. That ADR's decision 9 deliberately kept
  base-refresh byte-identical, so its conflicts still dead-end.

Forces:

- **`opId` changes per run (verified).** Every restack mints a new `opId`, so a decision cannot be
  bound to it. A range is identified by child, `oldParent` and `oldTip`; #3522 decision 4 already
  matches resolutions by that identity.
- **One clearing command per halt kind.** A `Restack-Conflict` halt is already cleared by
  `stack restack-resolve`, under the feature dispatch lease and with a check that the live HALT
  matches the record. A second clearing command with other rules (`halt clear`, which is TTY-only)
  would split one halt kind across two contracts.
- **Event spine.** The decision's recording and its application are occurrences that operators
  audit, so they are spine events. The decision itself is durable state the engine consumes, like
  the resolution ref (event-spine exception C), so it lives in a ref.

## Options Considered

### Option A: `halt clear --decision "<answer>"` (the 2026-10-29 pick)
- **Pros:** No new flag on the stack family. Reuses `halt_clear_authorized` and its rationale audit.
- **Cons:** TTY-only, so an operator's agent session cannot run it. It gives `Restack-Conflict`
  halts two clearing commands with different lease and validation rules. `--rationale` alone still
  cannot tell a plain retry from an answer.

### Option B: `stack restack-resolve --decision "<answer>"`, a sibling of `--tip` (chosen)
- **Pros:** One command per conflict halt, with the same lease, the same record and live-HALT match,
  and the same atomic clear. No TTY needed. The resolver does the rebase, so the operator supplies
  only the judgement it asked for.
- **Cons:** A third ref family under `restack/`. A provider resolver might still not settle the
  conflict with the answer in hand, so the escalation must say the decision was tried.

### Option C: a deterministic `--prefer upstream|source` side-pick
- **Pros:** No LLM involved. It covers the observed case ("settle in upstream favour").
- **Cons:** It cannot express a semantic answer, such as keeping a seam while adding an assertion.
  It needs its own validation of the replayed result.

## Decision

Option B.

1. **The conflict record and recipe cover both restack causes.**
   - **Write path.** `haltRecordedRestackConflict` writes the conflict record and the
     `Restack-Conflict: <k> <opId>` halt line for `base-refresh` journals as well as `feature-repair`
     ones.
   - **Recorded fields.** The fields are those of #3522 decision 1. For `base-refresh`, the candidate
     subjects are the resolver's ordered replay candidates, which already omit commits that are
     patch-equivalent to the new default.
   - **Halt text.** The halt prints both recipes: the scratch-branch rebase with
     `stack restack-resolve --tip`, and `stack restack-resolve --decision`.
   - **Out of scope.** Merge-bearing `flatten_refused` halts stay unchanged.
2. **`stack restack-resolve --slug <slug> --child <k> --decision "<answer>"` records a decision.**
   - **Flags.** `--decision` and `--tip` are mutually exclusive. Passing both or neither is refused.
   - **Shared refusals.** The command applies every up-front refusal of #3522 decision 3: daemon
     session, not stacked, lease unavailable, no record, record for another child, and no matching
     live HALT.
   - **Its own refusals.** It also refuses an empty answer and one longer than 4,000 characters.
   - **On success, in order:**
     - writes a JSON blob at `refs/conductor/<slug>/restack/decision/c<k>` with compare-and-swap,
       creating the ref or replacing a prior decision for the same child. The blob holds the
       conflict identity (child, `oldParent`, `oldTip`, commit, paths), the answer, and the operator
       identity from `resolveMachineOperatorIdentity`;
     - appends `restack_decision` with `action: recorded` (decision 5);
     - clears the HALT with `clearHaltAtomically`.

     A failure after the ref is written leaves the HALT in place and prints
     `recorded but could not …`, as the tip path does.
   - **The latest answer wins.** A successful clear makes a later answer for the same halt fail,
     because no matching live HALT remains. A failed clear leaves the HALT live, so the operator can
     still record the other kind:
     - recording `--decision` deletes a resolution ref for child `k` in the same compare-and-swap
       transaction that writes the decision;
     - recording `--tip` deletes a decision ref for child `k` in the same way.

     So at most one answer is ever recorded per child.
3. **The next restack delivers a matching decision to the resolver.**
   - **Where.** In `runRestack` and in recovery's `resumePlanned`, for either cause, when the replay
     of child `k`'s range is handed to `resolveRestackConflict`.
   - **Match.** A decision ref for `k` matches when its child, `oldParent` and `oldTip` equal the
     range's. The decision's commit and paths are context for the resolver, not part of the match.
   - **Delivery.** A matching decision is passed as `operatorDecision` (answer, commit, paths) on the
     resolver context: `ResolveRestackConflictOptions` → `RestackResolutionContext` →
     `ResolutionContext`. The engine emits `restack_decision` with `action: applied` before
     dispatch.
   - **Prompt.** `resolveRebaseConflict` adds the answer to its prompt as the operator's decision for
     that commit and those paths. It instructs the resolver to apply the decision and not to escalate
     the same question. When `operatorDecision` is absent the prompt is byte-identical to today's.
   - **If the resolver settles the replay,** the shipped guards apply unchanged: FR-8, FR-9 and path
     ownership. The child is recorded `resolved`.
   - **If it still escalates,** the conflict halt is written as decision 1 says. Its detail names the
     applied decision and the resolver's new reason. The decision ref is kept, so the operator can
     replace it or record a tip instead.
   - **A non-matching decision** (the range moved) is not delivered. The engine emits
     `restack_decision` with `action: stale`, and the resolver runs as today. If it escalates, the
     halt names the stale decision.
   - **No precedence is needed.** Decision 2 keeps at most one answer per child, so a consumed tip
     and a delivered decision never meet.
4. **A decision lives until the restack that applied it applies.**
   - **Journal record.** When a decision-assisted replay is recorded `resolved`, the journal stores
     the delivered decision in an optional `deliveredDecision {child, blob}` field. It is written in
     the same update as the status, beside #3522's `consumedResolution`, and parsed fail-closed the
     same way. Journal recovery therefore knows which decision ref to check and delete after a
     restart.
   - **Move check.** The ready→moved transaction's `verify` lines assert that the delivered decision
     ref still names that blob, alongside the shipped resolution checks.
   - **Deletion.** The applied transaction deletes it with compare-and-swap, together with the
     conflict record and parent pin. An aborted or halted restack never deletes it.
   - **Teardown.** `featureConductorRefNames` gains `restack/decision/c<k>` for every child id, so
     feature teardown deletes it by name.
5. **Events ride the spine as a new member,
   `restack_decision {child, action, commit, paths, operator?, opId?}`.**
   - **Actions.** `action` is `recorded`, `applied` or `stale`.
     - `operator` is set on `recorded`.
     - `opId` is set on `applied` and `stale`, from the running journal.
   - **Why not extend `restack_resolution`.** `restack_resolution` requires a `tip`, which a decision
     does not have, so its shape stays unchanged. The new member is registered in `EVENT_SINKS` like
     every other member.
   - **The answer text** is carried only in the ref blob, never on the event. Operators read it with
     the halt or with `git cat-file`.
6. **Parity.** All of these stay byte-for-byte unchanged:
   - a restack with no decision ref and no resolution ref;
   - restacks the resolver settles without a decision;
   - the plain (non-stacked) rebase resolver's prompt;
   - N=1 features;
   - routing-off behavior.

   Base-refresh conflict halts deliberately change (decision 1). Their text gains the
   `Restack-Conflict` line and the recipes, and they write the conflict refs. Neither moves a branch
   or closure ref.
7. **The runbook documents decide-then-resume.**
   - In `docs/runbooks/stalled-or-stuck-feature.md`, the stacked restack conflict section documents
     `--decision` beside `--tip` for both causes, including a closed child. It states that neither
     path edits branches or `refs/conductor/*` by hand.
   - `docs/reference/cli.md` documents the flag and its refusals.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | A field added to the restack resolver context reaches `resolveRebaseConflict`, because `restack-resolver.ts` spreads its context into the conductor resolver, which `daemon-cli.ts` wires to `stepRunner.resolveRebaseConflict` | verified | 90% | yes | The decision would never reach the prompt; the plan proves delivery with a test on the production resolver wiring | — |
| A2 | Executor and recovery both reach `haltRecordedRestackConflict` for an unresolved base-refresh conflict, with only its internal cause check withholding the record | verified | 85% | yes | Base-refresh would need a second halt path; the plan proves both entry points with real-git tests | — |
| A3 | A provider resolver given an explicit operator decision for the conflicting commit applies it instead of escalating the same question | unverified | 70% | yes | The halt would repeat with the decision named; the operator still has the tip path, and the plan tests only the engine's delivery and escalation shape with a fake resolver | APPROVED by operator 2026-10-31 |
| A4 | A base-refresh range's identity (child, `oldParent`, `oldTip`) stays unchanged across reruns until a restack applies, even when the default branch advances | inferred | 85% | yes | Decisions for base-refresh conflicts would be reported stale and never delivered; the plan carries a real-git test that advances the default between halt and rerun | APPROVED by operator 2026-10-31 |
| A5 | A recorded base-refresh tip often goes stale when the default branch advances before the rerun, because #3522 decision 4 requires the parent tree to match | inferred | 75% | no | None for correctness; the stale halt is the shipped outcome, and the decision path is the robust alternative | — |

## Consequences

### Positive
- An operator answers a resolver escalation in one line, and the resolver does the rebase.
- Base-refresh conflicts gain the same supported recovery as feature-repair ones.
- The audit trail names who decided what for which child and commit, and whether it was applied.

### Negative
- A third ref family under `restack/`, with its own teardown.
- Whether the resolver honors a decision is a prompt contract (A3). A stubborn conflict still costs a
  second halt, though that halt now names the decision.
- #3522's base-refresh parity promise and its test of it are reversed.

### Follow-up Actions
- [ ] Amend `adr-2026-10-25-operator-recorded-restack-conflict-resolution` decisions 1, 3, 4, 8 and 9,
      and `adr-2026-10-10-stacked-restack-journaled-replay` decision 6, with notes pointing here.
- [ ] Replace #3522's base-refresh parity story criterion in place.
- [x] Filed the split-out intake for the stale `HALT.cleared` body and the clear-watcher attribution as jstoup111/ai-conductor#3551.
