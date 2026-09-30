# Implementation Plan: Consume the kickback raise that matches the live halt

**Date:** 2026-09-28
**Stories:** .docs/stories/consume-kickback-raise-matching-the-live-halt-gene.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the change keeps the existing D6 "no unrelated halt is cleared" order (park, processed, live class, live generation, clear, consume) and only widens which unconsumed authorization is considered.

## Summary

Three bounded tasks deliver #2595. The daemon's resume-authorization sweep stops taking the first candidate gate in ledger order and instead selects the candidate bound to the live halt generation, logging every candidate it passes over as stale. `kickback-budget inspect` gains a per-gate resume-authorization state so an operator can see a raise that is stale or still awaiting the sweep. Expiring stale authorizations, the missing halt-record path tracked by #2752, and a plan-growth raise path are out of scope.

## Technical Approach

In `consumeResumeAuthorizations` (src/conductor/src/engine/daemon-rekick.ts), keep the park and processed checks and the unreadable-ledger refusal unchanged. Replace the single `find` with a `filter` that uses the same candidate predicate: readable gate, cap evidence and unconsumed authorization present, cap evidence gate equals the ledger key, and cap evidence generation equals the authorization generation. When there are no candidates, continue exactly as today without reading the live halt. Otherwise read the live halt class and live halt generation once. Select the single candidate whose cap evidence generation equals the trimmed live generation. For every other candidate, log one line naming the slug and gate and saying the authorization is stale, bound to its generation rather than the live one, and was not consumed. With no generation match, log the existing "retained — live halt generation does not match authorization" line and continue. With a match, apply the existing class check against `RECOVERABLE_CAP_HALT_CLASS_BY_GATE` for the selected gate and keep its existing retained log; then clear and consume exactly as today. Halt generations are unique per cap halt, so at most one candidate can match; if a corrupt ledger ever yields two, take the first match and log the rest as stale (no new branch). Stale authorizations are left in the ledger: they can never match a future halt, and removing them would add a ledger write this fix does not need.

In src/conductor/src/engine/kickback-budget-view.ts add an optional trailing `liveHaltGeneration` parameter to `kickbackBudgetView` and `renderKickbackBudgetView`. Derive a `resumeAuthorization` view field from the gate entry: absent when the entry has none; `consumed` when consumed; `awaiting-sweep` when unconsumed, bound to the gate's cap evidence generation, and equal to the live generation; otherwise `stale`. The JSON field carries the state, adjustment id, bound halt generation, and live halt generation (empty string when no live marker). The human rendering adds one line, for example "Resume authorization: stale (bound to halt generation X; live halt generation Y); the daemon will not consume it", "Resume authorization: awaiting daemon sweep", "Resume authorization: consumed", or "Resume authorization: none". Existing callers that omit the parameter keep compiling; with the live generation unknown, an unconsumed authorization renders as `pending (live halt not read)` rather than being guessed stale or awaiting.

In the inspect branch of `dispatchKickbackBudgetCommand` (src/conductor/src/engine/kickback-budget-cli.ts), read the live generation once with the exported `readKickbackHaltGeneration` from daemon-rekick.ts on the resolved worktree and pass it to both view calls. Inspect stays read-only; mutation paths are untouched.

Event spine: no new channel. The stale notice uses the sweep's existing injected `log` dependency; inspect renders durable ledger state.

## Preconditions and claim ledger

- Operator approved Small scope, technical track, and both stories on 2026-09-28 (delegated).
- Verified: `consumeResumeAuthorizations` in daemon-rekick.ts selects with `Object.entries(ledger.gates).find(...)` and `continue`s after the live generation mismatch without evaluating later gates.
- Verified: `RECOVERABLE_CAP_HALT_CLASS_BY_GATE` in halt-classification.ts maps prd_audit and architecture_review_as_built both to `kickback-cap` and build_review to `needs-human`.
- Verified: `readKickbackHaltGeneration` is exported from daemon-rekick.ts and parses `Kickback halt generation:` from the live HALT body, returning an empty string when absent.
- Verified: `KickbackResumeAuthorization` in kickback-ledger.ts has `adjustmentId`, `haltGeneration`, and `consumed`; `applyKickbackBudgetAdjustment` writes it for one gate only.
- Verified: `kickbackBudgetView` and `renderKickbackBudgetView` in kickback-budget-view.ts take `(entry, gate, fallbackLimit, planGrowth?)` and do not read `resumeAuthorization`.
- Verified: the inspect branch of `dispatchKickbackBudgetCommand` in kickback-budget-cli.ts is read-only and calls both view functions per readable gate.
- Verified: existing tests live in src/conductor/test/engine/daemon-rekick.test.ts (describe consumeResumeAuthorizations), src/conductor/test/engine/kickback-budget-view.test.ts, and src/conductor/test/cli/kickback-budget.test.ts (makeFeature fixture writes the ledger under a temporary worktree).
- Verified: sibling #2752 changes halt-record supersession in halt-record.ts, not these functions.
- Scope check: A harness-repo-only (daemon machinery); B n/a; C provider-agnostic.
- Verify-claims verdict: CLEAR.

## Tasks

### Task 1: Select the authorization bound to the live halt in the sweep
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/daemon-rekick.ts, src/conductor/test/engine/daemon-rekick.test.ts
**Dependencies:** none

**Steps:**
1. In the existing consumeResumeAuthorizations describe block, add a fixture that seeds one ledger with a prd_audit entry whose authorization and cap evidence carry generation g0 listed before an architecture_review_as_built entry bound to g1, with live class kickback-cap and live generation g1. Capture log lines through the injected log dependency.
2. Establish RED: the current find selects prd_audit and retains the halt.
3. Replace find with filter as described in the Technical Approach; read the live class and generation only when candidates exist; select by live generation; log each unselected candidate as stale; keep the class check, clear, and consume order unchanged.
4. Run the focused test file through scoped-run and commit.

**Done when:**
1. A sweep fixture with a stale prd_audit authorization ahead of a matching architecture_review_as_built authorization returns the slug, invokes the clear once, and consumes only the architecture_review_as_built authorization.
2. The same fixture captures a log line naming the slug and prd_audit and stating the authorization is stale and not consumed.
3. Existing consumeResumeAuthorizations tests for partial clear, parked, processed, class mismatch, cross-gate evidence, and newer same-class generation keep passing unchanged.

### Task 2: Keep unrelated halts uncleared when no candidate matches
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** src/conductor/test/engine/daemon-rekick.test.ts
**Dependencies:** 1

**Steps:**
1. Add a fixture where the only generation-matching authorization is on build_review while the live class is kickback-cap, alongside a stale prd_audit authorization; assert the clear is never invoked and both authorizations stay unconsumed.
2. Add a fixture with two stale candidates and a live generation matching neither; assert the halt is retained, the clear is never invoked, and nothing is consumed.
3. Run the focused test file through scoped-run and commit.

**Done when:**
1. A class-mismatch fixture with a generation-matching build_review authorization never invokes the clear and leaves every authorization unconsumed.
2. A fixture whose live generation matches no candidate never invokes the clear and leaves every authorization unconsumed.

### Task 3: Report resume-authorization state in kickback-budget inspect
**Story:** Story 2
**Story:** Story 2 (negative path)
**Type:** happy-path
**Files:** src/conductor/src/engine/kickback-budget-view.ts, src/conductor/src/engine/kickback-budget-cli.ts, src/conductor/test/engine/kickback-budget-view.test.ts, src/conductor/test/cli/kickback-budget.test.ts
**Dependencies:** none

**Steps:**
1. Add view unit cases for no authorization, consumed, unconsumed bound to the live generation, unconsumed with a different live generation, and an omitted live generation; assert both the JSON view field and the rendered line.
2. Establish RED, then add the optional live-generation parameter and the derived resumeAuthorization field and line described in the Technical Approach.
3. Add an inspect CLI fixture using makeFeature: write a HALT marker carrying a live generation that differs from one gate's unconsumed authorization, run inspect in human and JSON formats, and assert the stale state with both generations; add a second run with no HALT marker asserting stale with an empty live generation and a byte-identical ledger.
4. Wire the inspect branch to read the live generation once via readKickbackHaltGeneration and pass it to both view calls.
5. Run the two focused test files through scoped-run and commit.

**Done when:**
1. View unit cases render none, consumed, awaiting-sweep, stale, and live-halt-not-read states in both the JSON view field and the human line.
2. The inspect CLI fixture reports the stale gate with its bound and live halt generations in human and JSON output.
3. The inspect CLI fixture with no HALT marker reports the unconsumed authorization as stale with an empty live generation and leaves the ledger byte-for-byte unchanged.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a feature whose ledger holds an unconsumed stale prd_audit authorization ahead of an unconsumed architecture_review_as_built authorization bound to the live cap halt generation, when the daemon's resume-authorization sweep runs, then the architecture_review_as_built authorization is consumed, the halt is cleared, and the prd_audit authorization stays unconsumed. | 1 | "A sweep fixture with a stale prd_audit authorization ahead of a matching architecture_review_as_built authorization returns the slug, invokes the clear once, and consumes only the architecture_review_as_built authorization." | diff-local |
| Story 1 negative: Given the only authorization bound to the live halt generation belongs to a gate whose recoverable cap halt class differs from the live halt class, when the sweep runs, then no halt is cleared and every authorization stays unconsumed. | 2 | "A class-mismatch fixture with a generation-matching build_review authorization never invokes the clear and leaves every authorization unconsumed." | diff-local |
| Story 1 negative: Given no unconsumed authorization is bound to the live halt generation, when the sweep runs, then the halt is retained and no authorization is consumed. | 2 | "A fixture whose live generation matches no candidate never invokes the clear and leaves every authorization unconsumed." | diff-local |
| Story 2 happy: Given an unconsumed authorization whose halt generation differs from the live halt generation, when the sweep runs, then the daemon log names that feature and gate and says the authorization is stale and was not consumed. | 1 | "The same fixture captures a log line naming the slug and prd_audit and stating the authorization is stale and not consumed." | diff-local |
| Story 2 happy: Given an unconsumed authorization whose halt generation differs from the live halt generation, when the operator runs kickback-budget inspect, then the human and JSON output report that gate's resume authorization as stale with its bound and live halt generations. | 3 | "The inspect CLI fixture reports the stale gate with its bound and live halt generations in human and JSON output." | diff-local |
| Story 2 happy: Given an unconsumed authorization bound to the live halt generation, when the operator runs kickback-budget inspect, then the output reports that gate's resume authorization as awaiting the daemon sweep. | 3 | "View unit cases render none, consumed, awaiting-sweep, stale, and live-halt-not-read states in both the JSON view field and the human line." | diff-local |
| Story 2 negative: Given a feature with no live HALT marker and an unconsumed authorization, when the operator runs kickback-budget inspect, then the authorization is reported as stale with no live halt generation and the ledger is left byte-for-byte unchanged. | 3 | "The inspect CLI fixture with no HALT marker reports the unconsumed authorization as stale with an empty live generation and leaves the ledger byte-for-byte unchanged." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures. Tasks 1 and 2 own the sweep at its function boundary with a real temporary ledger and injected live-halt readers, clear, and log; no daemon loop or conductor run is started. Task 3 owns view unit cases and one inspect CLI integration that runs the real dispatch, ledger read, and live-generation reader against a temporary worktree. Existing consumeResumeAuthorizations and inspect tests remain the regression net for unchanged behavior. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 3

Small tier: architecture and coherence artifacts are skipped. No new ADR or amendment is required; the adr-2026-08-29 D6 order and the adr-2026-08-31 malformed-sibling isolation are preserved.
