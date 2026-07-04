---
status: APPROVED
date: 2026-07-03
approved: 2026-07-03
supersedes: none
amends: none
deciders: James Stoup
issues: "#271"
---

# ADR: Halt-PR Rehabilitation at Finish (skill presentation, engine mechanics, gate enforcement)

## Status
APPROVED (2026-07-03, operator-confirmed in engineer session).

## Context
When a feature halts irrecoverably, `escalateBuildFailure`
(`build-failure-escalation.ts`) opens a draft PR titled
`needs-remediation: <branch> — manual remediation required`, labels it
`needs-remediation`, and comments the failure reason. After remediation and
re-kick, `finish` reuses that PR — but nothing rewrites its presentation or
state. Observed results (PR #231, PR #249): merged feature PRs still titled
`needs-remediation:`, boilerplate halt bodies, no `Closes` ref (origin issues
#204/#205 stayed open), draft state flipped late or by hand, and the stale
`needs-remediation` label suppresses the `mergeable` label forever
(`mergeable-sweep` FR-12).

The `/pr` skill already instructs `gh pr edit` when a PR exists — the failure
mode is unenforced skill adherence, not a missing instruction. Pure-engine
rewriting was rejected (template-quality title/body; violates the
fix-the-skill convention, #161 precedent); pure-skill fixing was rejected
(leaves deterministic, already-built mechanics to nondeterministic session
behavior).

## Decision
Split responsibility three ways when `finish` completes a feature whose
recorded PR observably carries a **halt signal** — a title prefixed
`needs-remediation:` OR the `needs-remediation` label. Draft status alone is
NOT a halt signal: the `pr_timing: early-draft` mode (#199, unshipped) opens
legitimate draft PRs at build start with clean titles, and detection must not
misclassify them (conflict-check 2026-07-03, Option 1). Draft state is instead
a *facet to fix* once a halt signal is established:

1. **Skill owns presentation.** `/finish` (Option 2) and `/pr` gain an explicit
   rehabilitation step: when the PR pre-exists, regenerate title + body exactly
   as for a fresh PR (`gh pr edit`), replacing the halt banner/boilerplate.
   Halt history stays in the PR comment thread, which is never rewritten.
2. **Engine owns mechanics, deterministically.** A new engine step
   (`rehabilitateHaltPr`, called from the daemon's post-run tail beside —
   or absorbing — `closeIssueOnImplementationMerge`) composes EXISTING
   primitives: `setReady` (draft→ready), `removeLabel('needs-remediation')`
   (REST), `injectIssueRef` (`Closes`, idempotent, only when the item carries a
   `sourceRef`). All mechanics are warn-only: failures log and never block the
   ship (mirrors `conduct shipped-record` degradation).
3. **Gate enforces presentation.** The finish completion check
   (`artifacts.ts`, `finish-choice`/`pr_url` block) additionally reads the
   recorded PR (`gh pr view --json title,isDraft,labels`) and FAILS the step
   while the title still starts with `needs-remediation:` (retries drive the
   skill to comply; the existing per-step retry cap bounds burn). The gate is
   **fail-open on read errors**: a `gh` failure passes with a warning —
   network unavailability never blocks a ship.
4. **Detection is stateless.** Halt-PR origin is derived only from observable
   PR state (title prefix / label per above — never draft status alone, and
   never config state). No new marker files, ledger entries, or history
   parsing.

## Consequences
- **Positive:** a remediated feature's merged PR is indistinguishable from a
  never-halted one; origin issues auto-close on merge (`Closes` present
  exactly once via idempotent injection); the `mergeable` watch works again on
  reused halt PRs (label no longer suppresses FR-10); no new gh plumbing —
  composition of tested primitives.
- **Negative / trade-offs:** the finish gate gains a network read (bounded:
  one `gh pr view` per finish completion, fail-open); skill non-adherence
  plus a simultaneous gh outage can still ship a stale title (rare, logged);
  bounded retry burn when the skill repeatedly skips the rewrite — HALT is
  then correct, and the failure reason names the stale field.
- **Out of scope:** birth-side verify-after-write for label/draft (#274);
  merge behavior (ADR-005/ADR-010 untouched — humans merge); rekick semantics
  (adr-013 untouched).

## Alternatives Rejected
- **Engine-only rewrite** — deterministic but template-quality presentation;
  breaks the fix-the-skill convention.
- **Skill + gate only (no engine step)** — leaves ready-flip/label/Closes to
  session nondeterminism when the primitives already exist engine-side.
- **Fail-closed gate on gh read errors** — a gh outage would HALT otherwise
  shipped features; presentation is not worth blocking a ship.
- **Local marker recording halt-PR origin** — extra state to keep consistent;
  observable PR state is already authoritative.
