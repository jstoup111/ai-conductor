# Conflict Check: configurable-pr-timing (2026-07-03)

**New stories:** `.docs/stories/make-daemon-build-push-pr-timing-a-configurable-st.md` (TS-1…TS-8)
**Corpus scanned:** all `.docs/stories/` incl. phase-9.0-rebase-on-latest,
rebase-resolution-skill, daemon-pr-labels, engineer-worktree-isolation, multi-operator
slices, content-aware dedup, dependency-ordered-intake, harness-self-host-guardrails,
phase-9.3b write-back, intake-issue-pr-link-autoclose, daemon-halt-reconciliation.
**Result:** PASSED after resolution — 2 blocking conflicts found and resolved, 3 degrading
noted and accepted, 1 superseding-free ADR added.

## Resolved blocking conflicts

### Conflict: Self-host VersionApprovalGate vs build-start draft PR
**Stories:** harness-self-host-guardrails TR-7…TR-10 vs TS-2
**Type:** contradiction / impossible-state · **Severity:** blocking (resolved)
TR-7 requires a harness self-build to HALT for semver approval **before any PR opens**;
TS-2 opens a draft PR at build start.
**Resolution (operator-selected):** self-host builds force effective mode `finish` with a
loud downgrade log, via the SelfHostDetector seam — captured as
adr-2026-07-03-pr-timing-self-host-precedence (APPROVED); TS-1/TS-2 amended.

### Conflict: Fail-closed identity refusal vs checkpoint pushes
**Stories:** multi-operator-ownership-hardening Story 4 (+ slice-b Story 1) vs TS-6
**Type:** sequencing / impossible-state · **Severity:** blocking (resolved)
An unresolved-identity refusal must leave no `spec/<slug>` branch and no un-owned
artifact; ungated checkpoint commits/pushes could create both before land refuses.
**Resolution (operator-selected):** checkpoint activity is gated strictly after the
pre-DECIDE identity fail-fast; unresolved identity → zero checkpoint commits/pushes.
TS-6 amended (precondition + negative path + Done When).

## Accepted degrading conflicts

1. **phase-9.0 "no PR on rebase HALT"** — under early-draft a draft PR pre-exists a
   rebase-conflict HALT. State-level invariant holds (`pr_url` still set only at finish;
   the rebase step itself opens nothing; zero pushes while paused). Accepted as a
   mode-gated broadening; finish mode preserves phase-9.0 verbatim.
2. **daemon-pr-labels draft semantics** — "draft PR" no longer implies escalation; the
   machine signal was always the `needs-remediation` label (mergeable exclusion keys on
   the label, not draft state). Human reading only. Accepted.
3. **engineer-worktree-isolation single-commit/create-argv test assumptions** — FR-3/FR-9
   "commit file list" and FR-4 "gh pr create argv" tests describe finish-mode behavior;
   early-draft spreads the set over checkpoint commits and may mark-ready instead of
   create. No-cross-idea-bleed still holds (`.docs`-scoped checkpoints in the isolated
   worktree). Existing tests must keep passing in finish mode (TS-7/TS-8 Done When).

## Non-blocking flags for /plan

- **Closes-ref parity:** assert `injectIssueRef` runs against the REUSED draft PR at
  finish (TS-5 Done When added) — auto-close-on-merge must be mode-independent.
- **Config-surface merge coordination:** `validateConfig`/`knownTopLevelKeys`/
  `HarnessConfig` are additively extended by this spec and by dependency-ordered-intake,
  self-host-guardrails, rebase-resolution — expect CHANGELOG/config-list textual conflicts
  at merge time; resolve additively.

## Clean verdicts

rebase-resolution-skill (local-only resolver; post-rebase push fires only after success),
content-aware dedup (keys on file bytes, not commits), dependency-ordered-intake
(orthogonal gate; additive config overlap only), phase-9.3b write-back (TS-8 preserves it
verbatim), daemon-halt-reconciliation (re-kick sweep does no pushes; local abort during
HALT compatible with zero-push rule).
