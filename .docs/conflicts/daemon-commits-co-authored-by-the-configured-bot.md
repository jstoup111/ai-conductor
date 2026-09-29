# Conflict Check: Daemon commits co-authored by the configured bot (#2722)

**Date:** 2026-09-28
**Stories checked:** `.docs/stories/daemon-commits-co-authored-by-the-configured-bot.md` (Stories 1–6) against all 494 story files
**ADR corpus:** `repo_wide`. 58 ADRs examined after subject narrowing; 256 narrowed out by title, status, and subject; 8 fully superseded ADRs excluded (adr-2026-07-03-gated-writeback-announcements, adr-2026-07-21-completeness-as-build-review-rubric, adr-2026-07-30-finish-only-mergeability-gate, adr-2026-08-12-removal-anchored-tautology-exemption, adr-2026-08-15-verify-only-anchored-tautology-exemption, adr-2026-08-16-preservation-anchored-completeness-exemption, adr-2026-08-29-build-review-remediate-case-adjudication, adr-2026-08-29-operator-authorized-kickback-budget-recovery).
**Result:** PASS after resolution. One blocking conflict resolved; seven degrading conflicts resolved; zero remain.

## Conflict: #158 stories keep every read on the operator credential

**Stories involved:** Optional bot identity Story 2 vs Story 1 (bot co-author identity)
**Files:** [.docs/stories/use-a-dedicated-bot-identity-for-daemon-github-act.md] vs [.docs/stories/daemon-commits-co-authored-by-the-configured-bot.md]
**Type:** contradiction
**Severity:** blocking

**Description:** The #158 stories say "Every read stays on the operator's credential." and "a guarded `read` operation, operator identity resolution (`gh api user`), or `--assignee @me` intake capture runs, **Then** its `gh` child receives no bot token". The new Story 1 requires "one identity read performed with the bot credential, not the operator's". The #158 definition of a write ("any guarded GitHub operation whose access class is not `read`") would also pull the new read into #158 Story 4's operator fallback, which new Story 1 forbids.

**Resolution Options:**
1. Replace the #158 story assertions in place to name the D10.1 bot self-identity read as the single exception, excluded from the write fallback, and add a new-story criterion that operator identity resolution is unchanged.
2. Register the identity read as an ordinary `read` and resolve it with the operator credential (defeats the operator's derive-from-token decision).

**Recommendation:** Option 1. adr-2026-09-11-github-operation-ownership D10.1 already records the exception. **Applied:** new Story 1 gained the operator-identity-unchanged criterion; the #158 story text is replaced in a companion main-based PR, because the land stem gate refuses foreign-stem story edits on the spec branch.

## Conflict: Task-stamping stories read as "message unchanged"

**Stories involved:** Deterministic evidence attribution Story 4; build-dispatch-can-start-with-current-task-none Scenario 3.1; engine-must-invoke-task-start-done-at-subagent-dis; inline-build-work-commits-unattributed-session-hoo Surface A; prepare-commit-msg-reconciles-self-stamped-trailer Scenario 3b — vs new Stories 2 and 3
**Type:** contradiction (wording)
**Severity:** degrading

**Description:** Those stories say the hook "abstains — message unchanged" or the commit "lands with no trailer", meaning no `Task:` trailer. With a bot configured, the new stories add the bot trailer in the same cases.

**Resolution Options:**
1. Reword each to "no `Task:` trailer" in place.
2. Leave them; their tests run with no bot configured and stay true.

**Recommendation:** Option 1, in the same companion PR. **Applied.**

## Conflict: Story 2 pinned a retired Task: stamp

**Stories involved:** new Story 2 vs ADR: concurrent task telemetry
**Files:** [.docs/stories/daemon-commits-co-authored-by-the-configured-bot.md] vs [.docs/decisions/adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation.md]
**Type:** state-conflict
**Severity:** degrading
**ADR filename stem:** adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation
**Story ID:** Story 2
**ADR opposing sentence (verbatim):** "Automatic `Task:` injection from `.pipeline/current-task` is retired; task-local commit trailers are best-effort telemetry and may be absent."
**Story opposing sentence (verbatim):** "alongside the `Task:` trailer the hook already stamps."

**Description:** The story made the retired automatic `Task:` stamp an acceptance fact.

**Resolution Options:**
1. Reword to "any `Task:` trailer the message carries is preserved" and make D10.3 independent of the `Task:` stamp.

**Recommendation:** Option 1. **Applied** to Story 2 and D10.3.

## Conflict: Tracker-client seam says github reads keep existing auth

**Stories involved:** new Story 1 vs ADR: canonical tracker client seam
**Files:** [.docs/stories/daemon-commits-co-authored-by-the-configured-bot.md] vs [.docs/decisions/adr-2026-07-22-canonical-tracker-client-seam.md]
**Type:** contradiction
**Severity:** degrading
**ADR filename stem:** adr-2026-07-22-canonical-tracker-client-seam
**Story ID:** Story 1
**ADR opposing sentence (verbatim):** "\"`github` keeps the `gh` CLI and its existing auth\" still holds for reads and for every operator without a bot."
**Story opposing sentence (verbatim):** "using one identity read performed with the bot credential, not the operator's."

**Resolution Options:**
1. Cross-reference the exception inside D10.1 (no second ADR change).
2. Add an amendment note to the tracker-client seam ADR.

**Recommendation:** Option 1 — the governing exception lives in one place. **Applied** to D10.1.

## Conflict: Reseal recovery commits inside a daemon worktree

**Stories involved:** new Story 4 vs ADR: operator-only scoped artifact reseal
**Files:** [.docs/stories/daemon-commits-co-authored-by-the-configured-bot.md] vs [.docs/decisions/adr-2026-08-09-operator-only-scoped-artifact-reseal.md]
**Type:** overlap
**Severity:** degrading
**ADR filename stem:** adr-2026-08-09-operator-only-scoped-artifact-reseal
**Story ID:** Story 4
**ADR opposing sentence (verbatim):** "The operator must commit the corrected artifact before resealing, and reseal refuses on a dirty protected-artifact workspace."
**Story opposing sentence (verbatim, D10.3 as first drafted):** "Commits from operator-run CLIs and manual operator commits are never stamped."

**Description:** The quoted D10.3 sentence claimed every manual commit is unstamped, but a reseal recovery commit is made by hand inside the daemon worktree, whose hook cannot tell the operator from the agent.

**Resolution Options:**
1. Scope the exclusion to manual commits outside daemon worktrees; a hand commit inside one is treated like any commit there (operator: either outcome is acceptable, 2026-09-28).

**Recommendation:** Option 1. **Applied** to D10.3; Story 4 already scopes to the root checkout and operator-created worktrees.

## Conflict: CI-fix and rebase-resolution worktrees were uncovered

**Stories involved:** new Stories 2 and 3 vs ADR: SHIP CI feedback loop
**Files:** [.docs/stories/daemon-commits-co-authored-by-the-configured-bot.md] vs [.docs/decisions/adr-2026-07-07-ship-ci-feedback-loop.md]
**Type:** overlap
**Severity:** degrading
**ADR filename stem:** adr-2026-07-07-ship-ci-feedback-loop
**Story ID:** Story 2
**ADR opposing sentence (verbatim):** "The daemon now pushes commits to already-shipped PRs"
**Story opposing sentence (verbatim):** "Daemon worktree means a feature worktree that daemon dispatch prepared"

**Description:** CI-fix and rebase-resolution agent commits are daemon-created but prepared outside the feature-dispatch path, so the confirmed "every commit the daemon creates" scope would have missed them.

**Resolution Options:**
1. Widen the daemon-worktree definition and add a Story 2 criterion (within the confirmed scope).

**Recommendation:** Option 1. **Applied.**

## Conflict: Shipment repair reachable from an operator CLI

**Stories involved:** new Story 3 vs new Story 4 (with durable-shipped-record-enforcement-and-backfill-916-936 ST-916-4)
**Type:** sequencing
**Severity:** degrading

**Description:** The shipment-repair commit is published by both the running daemon and the operator-run daemon park command.

**Resolution Options:**
1. Stamp only when the daemon composition supplies the identity; add a Story 4 criterion for the operator path.

**Recommendation:** Option 1. **Applied.**

## Architecture-induced gaps closed in the new stories

- Identity-read failure is not retried within a dispatch (one read, one warning per dispatch).
- A login outside GitHub's character set is rejected, so hook input stays literal data.
- Hook installation fails closed during preparation (adr-2026-08-07 D3), and the co-author value is written only after hooks install, so a failed installation never leaves a co-author value behind.
- The identity read never runs inside a halt or other commit path (adr-2026-08-23-committed-halt-record).
- The co-author value is written before project setup, so setup-triage fix-session commits are stamped (adr-2026-07-09-setup-failure-triage).
- A failed co-author value write never blocks preparation (adr-2026-07-11-pipeline-state-durability D1).

## Assumptions recorded (not conflicts)

- adr-2026-07-11-semantic-attribution-verification-lane item 9 freezes growth of the task-evidence mechanical lane; the co-author stamp is commit attribution outside that lane, which adr-2026-07-21-demote-task-stamping-to-telemetry already retired (~75% it does not apply).
- The hook asset is regenerated by every worktree preparation, so consumers need no migration block; the implementation PR carries a `note` release disposition (~80%).
- The skip warning's cosmetic appearance in plan-scope rationale text (adr-2026-08-09-non-blocking-plan-scope-containment D2) is accepted.
