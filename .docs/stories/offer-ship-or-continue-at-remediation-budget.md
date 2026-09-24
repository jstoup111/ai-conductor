**Status:** Accepted

# Every remediation budget halt is recoverable by one kickback-budget raise

Source: https://github.com/jstoup111/ai-conductor/issues/2185 (folds #2192)
Track: technical. Tier: M.

## Context

The intake asked for a choice at a spent remediation budget on a green feature: ship as a draft PR
with the residuals listed, or grant more laps and continue. The operator narrowed it to the
**continue** half only (2026-09-24). The workflow stays the finisher: there is no draft-ship path,
no residuals list, no finding-named skipped tests, no release hold, no resume entry point, and no
unattended automatic grant.

`kickback-budget raise` (#2190) already continues a feature halted at a lap cap. It cannot continue
one halted on plan growth. The shared growth exit records no cap evidence, and raise only ever grows
laps. Per adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class D5, every remediation
budget exit now names the allowance it exhausted, and raise grows that allowance. Halts written
before this change keep their lap-shaped evidence and recover exactly as they do today.

## Story 1: Every remediation budget exit records which allowance ran out

As the operator, I want every `prd_audit` and `architecture_review_as_built` budget halt to carry typed evidence naming the exhausted allowance, so that a recovery command can bind to the halt and grow the right allowance.

### Acceptance Criteria

#### Happy Path
- **Given** a feature whose `prd_audit` remediation laps equal its effective lap cap, **When** prd_audit asks to append fix tasks, **Then** the feature halts `kickback-cap` and the ledger's `prd_audit` entry carries cap evidence with allowance `laps`, consumed equal to laps used, limit equal to the effective lap cap, and a fresh halt generation that the halt body repeats on a `Kickback halt generation:` line.
- **Given** a feature with prd_audit laps remaining whose fix-task request exceeds the remaining plan-growth allowance, **When** prd_audit asks to append, **Then** the feature halts `kickback-cap` and the `prd_audit` cap evidence carries allowance `growth`, consumed equal to the recorded added task count, limit equal to the effective growth cap, and a fresh halt generation repeated in the halt body.
- **Given** a feature with as-built laps remaining whose as-built fix-task request exceeds the remaining plan-growth allowance, **When** architecture_review_as_built asks to append, **Then** the feature halts `kickback-cap` and the `architecture_review_as_built` cap evidence carries allowance `growth` with consumed equal to added, limit equal to the effective growth cap, and a fresh halt generation repeated in the halt body.
- **Given** a validation-group round where prd_audit and as-built each fit their own allowance but their combined fix-task request exceeds the shared remaining plan-growth allowance, **When** the router checks the shared allowance, **Then** the feature halts `kickback-cap` and the `prd_audit` cap evidence carries allowance `growth` and a fresh halt generation repeated in the halt body, where today no evidence and no generation line are written.

#### Negative Paths
- **Given** a remediation lap that only restages existing tasks (an `existing-task` disposition with no appended tasks) and laps remaining, **When** it runs, **Then** no cap evidence is written and no plan growth is charged.
- **Given** an `existing-task` remediation arriving when the gate's laps are exhausted, **When** the router checks the budget, **Then** the cap evidence names allowance `laps`, never `growth`.
- **Given** a kickback ledger whose gate entry is unreadable, **When** the remediation budget is read, **Then** no remediation task is appended, no cap evidence is written, and no halt carrying a `Kickback halt generation:` line is written.
- **Given** a remediation request from a source that has no plan-growth allowance at all (not a validated prd_audit FIXABLE or as-built REMEDIABLE finding), **When** the router refuses it, **Then** the halt writes no cap evidence and names no recovery command, because it is a policy refusal and not a spent budget.
- **Given** a ledger written before this change whose cap evidence has no allowance field, **When** it is read, **Then** the evidence is treated as allowance `laps` and the ledger stays readable.
- **Given** a cap evidence entry whose allowance is any value other than `laps` or `growth`, **When** the ledger is read, **Then** that gate reads unreadable and fails closed, while sibling gates keep their values.

### Done When
- [ ] One unit test per exit (prd_audit laps, prd_audit growth, as-built growth, shared growth) reads the ledger after the halt and asserts the evidence allowance, consumed, limit, and a generation that appears in the halt body.
- [ ] A unit test asserts the shared growth exit's halt body contains a `Kickback halt generation:` line matching the ledger evidence.
- [ ] A unit test asserts an existing-task-only lap at exhausted laps records allowance `laps`.
- [ ] Ledger parser tests assert absent allowance normalizes to `laps` and an unknown allowance value makes only that gate unreadable.

## Story 2: `kickback-budget raise` grows the plan-growth allowance when growth ran out

As the operator, I want `ai-conductor kickback-budget raise --feature «slug» --gate «gate» --by N --rationale "«why»"` to grow the plan-growth allowance when that is what halted the feature, so that a growth halt continues through the workflow without a config edit or a commit on main.

### Acceptance Criteria

#### Happy Path
- **Given** a feature halted by as-built on the plan-growth allowance at 6 of 10 appended with 6 requested and 4 remaining, **When** the operator runs `raise --gate architecture_review_as_built --by 2 --rationale "one more lap"` from an interactive terminal, **Then** the feature's effective growth cap becomes 12, `added`, `byGate`, and every gate's laps are unchanged, one adjustment record naming allowance `growth` and one `kickback_budget_adjustment_authorized` event naming allowance `growth` are written, a resume authorization bound to the halt generation is installed, and the command exits 0.
- **Given** that authorization and the temporary park released, **When** the daemon reaches the halted feature, **Then** it consumes the authorization, clears the halt through the existing clear, and the re-dispatched remediation appends its 6 fix tasks within the raised allowance without halting again.
- **Given** a feature halted at the prd_audit lap cap with evidence naming `laps`, **When** the operator runs `raise --gate prd_audit --by 1`, **Then** the effective lap cap grows by 1 exactly as before this change and the growth record and any raised growth cap are byte-for-byte unchanged.
- **Given** a feature with a raised effective growth cap, **When** a rebase credit refunds lap-counting fields, **Then** the raised growth cap survives unchanged.
- **Given** a feature with a raised effective growth cap whose growth counts are recomputed from the plan because the recorded counts are impossible, **When** the growth record is read, **Then** the counts are recomputed and the raised growth cap survives unchanged.

#### Negative Paths
- **Given** a feature halted with evidence naming `growth`, **When** the operator runs `kickback-budget reset --gate «that gate»`, **Then** it refuses with a message naming `raise` as the growth recovery, changes nothing in the ledger, leaves the park as it found it, and exits non-zero.
- **Given** a feature raised by 1 when its remediation needs 2 more tasks, **When** the daemon resumes it, **Then** it halts again on growth with a new halt generation, and the consumed earlier authorization cannot clear the new halt.
- **Given** a feature halted on growth before this change, with evidence carrying no allowance, **When** the operator runs raise, **Then** the lap cap grows as it does today, the growth cap is unchanged, and the output shows the growth allowance still exhausted.
- **Given** a raised effective growth cap that is not a positive safe integer, **When** the ledger is read, **Then** the value is not repaired or recomputed, no remediation task is appended, and raise refuses.
- **Given** one feature's growth cap is raised, **When** another feature or the repository config is read, **Then** neither changes and the other feature's growth cap is still config-derived.

### Done When
- [ ] A unit test raises growth on an as-built growth halt and asserts the new effective growth cap, unchanged `added`, `byGate`, and laps, one history record and one sibling-ledger event carrying allowance `growth`, and an installed resume authorization.
- [ ] A conductor test asserts that after a growth raise the remediation budget read resolves the raised cap in place of the config-derived cap, and the pending append succeeds.
- [ ] A unit test asserts `reset` refuses on growth evidence with the ledger byte-for-byte unchanged.
- [ ] A unit test asserts a lap raise leaves the growth record byte-for-byte unchanged.
- [ ] A unit test asserts the raised growth cap survives rebase credit and a growth-count recompute, and every value raise writes re-reads through `readKickbackLedger` without error.

## Story 3: The operator can see which allowance ran out and how to continue

As the operator, I want the halt, `kickback-budget inspect`, and `daemon status` to name the exhausted allowance and the exact recovery command, so that I never reconstruct the budget from ledger files.

### Acceptance Criteria

#### Happy Path
- **Given** any remediation budget halt written after this change, **When** the operator reads the HALT body, **Then** it names the exhausted allowance and prints the exact command `ai-conductor kickback-budget raise --feature «slug» --gate «gate» --by «N» --rationale "«why»"` with the feature slug and gate filled in.
- **Given** a feature whose growth cap was raised, **When** the operator runs `kickback-budget inspect --feature «slug»`, **Then** the output shows plan growth added and the effective growth cap alongside each gate's laps and limit, and the adjustment history lists the growth raise with its allowance.
- **Given** a halted feature with growth cap evidence, **When** the operator runs `ai-conductor daemon status`, **Then** the feature's PLAN GROWTH line reports remaining against the effective growth cap, raised when raised, and its KICKBACK BUDGET line names the exhausted allowance.

#### Negative Paths
- **Given** the operator edits or deletes the recovery command line in the HALT body, **When** they run raise with the generation line and ledger evidence intact, **Then** raise succeeds, because the command line is never parsed.
- **Given** a feature with no raised growth cap, **When** inspect or daemon status renders it, **Then** the growth cap shown equals the config-derived cap and no raised value is invented.
- **Given** inspect run without an interactive terminal, **When** it renders a growth-halted feature, **Then** it succeeds read-only and the ledger is byte-for-byte unchanged.

### Done When
- [ ] A unit test per exit asserts the halt body names the allowance and contains the recovery command with slug and gate filled in.
- [ ] A budget-view unit test asserts inspect renders growth added and the effective growth cap, both raised and config-derived.
- [ ] A daemon-status unit test asserts the PLAN GROWTH line uses the raised cap when present and the KICKBACK BUDGET line names the allowance.
