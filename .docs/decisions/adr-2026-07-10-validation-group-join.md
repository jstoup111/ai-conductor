# ADR: SHIP validation group — membership, join policy, and consolidated remediation

**Date:** 2026-07-10
**Status:** APPROVED (operator-approved 2026-07-10)
**Deciders:** James Stoup (operator), engineer session (ai-conductor#469)
**Depends on:** adr-2026-07-10-concurrent-group-core
**Preserves:** adr-2026-07-06-manual-test-fail-routing

## Context

With a correct concurrent core available, the SHIP tail's three validators —
`manual_test`, `prd_audit`, `architecture_review_as_built` — can fan out after
`build_review`. Verified facts (2026-07-10 code inspection):

- The three are **write-disjoint** (`.pipeline/manual-test-results.md`, `prd-audit.md`,
  `architecture-review-as-built.md`) and **read-independent**; only prose "after X" lines
  in their SKILL.md files order them today.
- `planRemediation(state, steps, dispatchContext, hintSource)` is already **one planner
  for every gate** (its doc comment says exactly that); only the dispatch context and the
  evidence-file pointer differ per source. Today it is invoked per-gate, serially.
- `manual_test` FAIL routing is governed by the APPROVED
  adr-2026-07-06-manual-test-fail-routing: deterministic kickback to `build` with FAIL
  rows as the retry hint, self-heal budget `MAX_KICKBACKS_PER_GATE`, whitewash guard —
  **no `/remediate` dispatch, no LLM**.
- Membership is dynamic: technical track skips `prd_audit`
  (`skippableForTracks: ['technical']`); S tier or a skipped DECIDE review skips
  `architecture_review_as_built` (`skippableForTiers: ['S']` + `skipWhenSkipped`);
  `manual_test` skips by feature-type (no HTTP/API/UI story). Fan-out width is 0–3.
- `manual_test` is the only runtime-mutating member (real server, hardcoded port 3000;
  no per-worktree port/DB isolation primitive exists in-tree). The other two are
  read-only auditors.

## Options Considered

### Join policy
- **First failure cancels siblings** — serial-equivalent; loses the consolidated
  kickback that motivated #469. Rejected.
- **Wait for all, always; missing verdicts become synthetic gaps** — remediate would act
  on infra noise (#385-shape marker-missing exits). Rejected.
- **Verdicts join, infra fails fast (chosen)** — a branch that produces a verdict
  (PASS/FAIL/BLOCKED) always waits for its siblings and joins; a branch that terminates
  with **no verdict after its own retries** fails the whole group through the normal
  step-failure path (halt) so infra breakage stays loud.

### manual_test FAIL at the join
- **Amend the 2026-07-06 ADR, route everything through remediate** — uniform pipeline,
  but re-opens a week-old APPROVED ADR and hands an LLM what machinery decides today.
  Rejected (deterministic-first).
- **Preserve the ADR; merge at the join (chosen)** — manual_test FAIL keeps its
  deterministic `build` classification; remediate plans only the prd-audit + as-built
  gaps.

## Decision

1. **Built-in group.** The SHIP sequence gains a built-in validation group entry (in
   `steps.ts`, on the concurrent group core) whose members are the three validators.
   Member skip rules are evaluated exactly as today (tier/track/feature-type/
   `skipWhenSkipped`); skipped members simply don't dispatch. A group whose effective
   width is ≤1 degrades to today's serial behavior with no semantic change.
2. **Join policy: verdicts join, infra fails fast.** All dispatched branches run to a
   verdict; the join then evaluates the union. A no-verdict branch (its retries
   exhausted without its completion marker) fails the group → the existing step-failure
   handling (halt in auto mode). No synthetic gaps are invented for it.
3. **Consolidated kickback.** On join with failures:
   - `manual_test` FAIL rows → deterministic `build` classification per the preserved
     2026-07-06 ADR (budget and whitewash guard unchanged).
   - `prd_audit` + `architecture_review_as_built` blocking gaps → **one**
     `planRemediation` dispatch whose hint enumerates every present evidence file
     (the multi-source `hintSource` seam), producing per-gap dispositions in a single
     pass.
   - The engine merges both classification streams into **one work order**: the rewind
     target is the earliest step among all dispositions (`earliestRemediationTarget`,
     default `build`), with manual_test FAIL rows attached as evidence alongside the
     remediation hint. One rewind instead of up to three serial ones.
   - Per-gate self-heal budgets (`MAX_KICKBACKS_PER_GATE`, `manualTestSelfHeals`,
     `remediationRounds`) keep their existing per-gate accounting — parallelism must not
     multiply retry budgets.
4. **All-green join** → group `done`, loop continues to `retro`/`rebase`/`finish`
   unchanged.
5. **Concurrency safety notes (binding on implementation):**
   - Branches write only their own `.pipeline/` artifacts; the core is the single writer
     of `conduct-state.json` and `.pipeline/gates/*` verdicts at join.
   - `manual_test`'s runtime side effects are tolerated because its siblings are
     read-only; the group definition must assert this property (a future runtime-mutating
     member requires an isolation primitive first — record as a constraint, not built now).
   - Burst rate: the cap (default 2) plus shared rate-limit episode is the mitigation for
     the tripled-burst concern in #469.

## Consequences

### Positive
- SHIP tail wall-clock drops from sum to ~max of validator durations (#469's goal).
- One consolidated kickback work order per round — no first-failure-wins serial
  discovery; evidence from all validators lands in the same rewind.
- #385-class infra failures stay loud (group halt), never laundered into remediation.

### Negative
- Join/merge logic is new engine complexity at an already-dense seam.
- A slow validator delays the join (max-of-durations includes the slowest).
- Interleaved branch logs are harder to read than serial logs (mitigated by
  branch-labeled events).

### Follow-up Actions
- [ ] SKILL.md prose "runs after X / before Y" lines in manual-test, prd-audit,
      architecture-review updated to describe group membership (same PR)
- [ ] HARNESS.md SHIP sequence line + README pipeline table updated (same PR)
- [ ] Hold spec-PR merge until PR #481's evidence machinery is observed live
      (merged ≠ loaded ≠ exercised — operator gate)

## Addendum (2026-07-10, operator-approved conflict resolution)

**Auto-mode scoping.** The validation group fans out ONLY in daemon/auto mode. In
interactive (non-auto) mode the members run via the existing serial walk and
manual_test's post-step checkpoint pause is untouched (conductor.ts checkpoint
handling fires only when mode is not auto — concurrent dispatch would have started
siblings before the operator's checkpoint response). Resolution recorded in
.docs/conflicts/2026-07-10-parallel-validation-checkpoint-scoping.md.
