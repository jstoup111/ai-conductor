# Conflict Report: dependency-ordered-intake-and-dispatch (2026-07-03)

**New stories:** `.docs/stories/dependency-ordered-intake-and-dispatch.md` (#229)
**Scanned against:** all `.docs/stories/` on main; the concurrent, unlanded #200 artifact set
in `.worktrees/engineer-priority-list-for-daemon-execution-of-features-iss` (PRD
`2026-07-03-daemon-issue-priority-scheduling.md`, its stories, and ADRs
`priority-from-linked-issue-labels` / `priority-fetch-fail-soft`); unmerged `origin/spec/*`
branches (background-intake-conduct-loop, content-aware-shipped-work-dedup,
multi-operator-ownership-*, harness-daemon-profile, self-host-*).

**Result: zero blocking conflicts; one degrading conflict accepted with a documented
composition contract.**

## Checked and clean

- **#200 semantic compatibility (contradiction/state checks):** #200's FR-8 states priority
  never changes eligibility and an ineligible spec never head-of-line-blocks; #229's gate
  makes blocked specs non-dispatchable-this-cycle and its stories assert blocked specs never
  head-of-line-block unblocked ones. The two specs independently converge on the same
  contract: **dependency filter first (correctness), priority orders the survivors
  (preference).** #229's PRD declares #200 sequenced after; #200's PRD declares eligibility
  out of scope. No contradiction.
- **Fail-posture divergence is deliberate, not a conflict:** #200 fails soft (outage → pure
  date order; priority is preference), #229 fails closed (outage → visible WAITING; ordering
  is correctness). adr-2026-07-03-dependency-fail-closed-and-cache documents the asymmetry
  against the owner-gate precedent; #200's fail-soft ADR is consistent with it.
- **#200 FR-2 (unlinked specs outrank all) vs #229 FR-3 (unlinked specs never gated):**
  compatible — both treat no-origin specs as unconstrained by issue-graph state.
- **background-intake-conduct-loop (unmerged spec):** consumes the same claim path; deferral
  applies uniformly to any claimer — behavior change is consistent, no contradictory
  assertion found in its stories.
- **content-aware-shipped-work-dedup / owner-gate slice-B / daemon-profile / self-host:**
  orthogonal concerns (dedup identity, ownership, PR emission, sandboxing); no shared
  state/semantics with dependency gating beyond the gauntlet composition already ratified in
  adr-2026-07-03-dependency-gate-backlog-waiting-channel.

## Conflict: dispatch-chooser and status-surface mechanical overlap with #200

**Stories involved:** #229 "Blocked specs are visible in a WAITING group" + gate stories vs
#200 FR-1/FR-5/FR-10 (banded selection, tie-break preservation, effective-order status output)
**Files:** `.docs/stories/dependency-ordered-intake-and-dispatch.md` vs (worktree)
`.docs/stories/2026-07-03-daemon-issue-priority-scheduling.md`
**Type:** resource-contention (code surfaces + status semantics), NOT semantic
**Severity:** degrading

**Description:**
Both features modify backlog discovery/selection and the dashboard/status renderers, and both
introduce a per-scan GitHub read keyed off the spec's originating issue (priority labels vs
blocked-by relations). They are being authored concurrently on separate spec branches;
whichever merges second must reconcile signatures/tests on the shared surfaces, and the status
output must compose the two presentations coherently.

**Resolution Options:**
1. Accept as-is with a composition contract (filter-before-order, additive discovery shape,
   second-to-merge rebases, duplicate reads tolerated).
2. Merge the two specs into one combined dispatch-chooser feature — rejected: doubles scope,
   contradicts both PRDs' explicit sequencing decisions.
3. **Hard-sequence: #200 waits for #229** — #229 merges and builds first; #200's spec branch
   is rebased onto the result before its PR merges.

**Resolution (operator-selected 2026-07-03): Option 3 — hard-sequence, #200 behind #229.**

- #229's spec PR merges and builds first. The #200 spec branch
  (`spec/priority-list-for-daemon-execution-of-features-iss`) MUST be rebased/reconciled onto
  the merged #229 implementation before its own PR merges (refresh-spec-branch-base rule).
- **Enforced by the feature itself:** issue jstoup111/ai-conductor#200 receives a native
  "blocked by" link to issue #229 (via the migration's manual-review pass, or created directly
  by the operator). Once #229's gate is live, the daemon and intake defer #200's spec/idea
  until #229 is closed — the new mechanism polices its own sequencing.
- The composition contract from Option 1 still governs #200's rebase: dependency filter before
  priority ordering; a WAITING spec never appears in the banded/effective-order list; exactly
  one status bucket per spec; #229's `waiting` channel is additive so #200 orders `items`
  only. Consolidating the two per-issue GitHub reads (labels + relations) into one fetch is
  noted as a #200-side optimization opportunity during its rebase.

No #229 story text changes required — its stories already assert the exactly-one-bucket
invariant and no-head-of-line-blocking that the contract relies on.

## Re-check

With the hard-sequencing resolution applied: re-scan finds zero blocking conflicts and no
remaining degrading compromise on #229's side (the reconciliation burden moves to #200's
branch, where the operator has explicitly placed it). Check passes.
