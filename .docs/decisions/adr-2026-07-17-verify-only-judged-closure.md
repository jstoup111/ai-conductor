# ADR: Class-scoped judged closure for verify-only (prove-closed) plan tasks

**Date:** 2026-07-17
**Status:** APPROVED
**Deciders:** James Stoup (operator-directed spec for #677; approval via spec PR merge)

## Context

A plan task whose correct outcome is "no code change" (prove-closed / verification-only) cannot
produce commit-derived completion evidence. Verified against code (2026-07-17):

- `deriveCompletion` (autoheal.ts:606) accepts three non-code signals — empty commit with
  `Evidence: satisfied-by <sha>` (ancestor-of-HEAD checked, :690-696), empty commit with
  `Evidence: skipped <reason>` (:712-718), and a `semantic-verified` judge stamp (:803-808) —
  but a task with zero matching commits falls through to `skipped: "no derived evidence"`
  (:914-916) and its row stays `pending`.
- The gate's only completion currency is evidence stamps (artifacts.ts:1036, #463); the batch
  evaluator's APPROVE is never consulted.
- The gate-miss judged attribution lane (#520, attribution-lane.ts `runAttributionLane`,
  conductor.ts:3030-3105) does exactly the needed closure — dispatch a verifier for residue
  task ids, validate cited shas, write `semantic-verified` stamps, re-check completion in-loop —
  but is dark unless `attribution_judge_cutover` (config.ts:810) is armed. It was not armed on
  the #667 build, so task 4 stayed unresolved, `noEvidenceAttempts` hit 3 (conductor.ts:237,
  :3286) and the build auto-parked (daemon-auto-park.ts:135-138) despite evaluator APPROVE.
- The commit-msg hook (git-hook-assets.ts:88) rejects bare empty commits and demands a
  resolvable `Evidence: satisfied-by <sha>` (:191-205) — but does NOT accept
  `Evidence: skipped <reason>`, which autoheal does accept. A prove-closed task with no
  satisfying sha therefore has no commit form that can pass the hook at all.
- `/plan` (skills/plan/SKILL.md) has no concept of a verify-only task — zero hits for
  "verify-only"/"prove-closed" in src/ — so the engine cannot know a task was intended to be
  commit-less. The commit-less protocol exists only as prose in skills/tdd/SKILL.md:163-197,
  and the #667 session did not follow it: prompt discipline, the exact failure class the
  Design Principles forbid relying on.

**Premise correction (recorded per #677 outcome 3):** the `▶ build 0/N` line is NOT a
first-unresolved-index. It is a count of completed/skipped rows
(build-progress-watcher.ts:77-78). It read 0/8 because rows never flip without evidence;
fixing evidence flow fixes the display with zero display-code changes.

## Decision

1. **`/plan` marks prove-closed tasks deterministically.** A task whose GREEN can legitimately
   produce no code delta MUST carry a `**Verify-only:** yes` line in its task block. The plan
   skill's authoring rules and template gain this contract; unmarked tasks remain
   commit-expected. `parsePlanTaskPaths` (autoheal.ts) exposes a per-task `verifyOnly` flag.
2. **Class-scoped arming of the existing judge lane.** On the gate-miss branch, residue tasks
   whose plan block is marked `Verify-only: yes` dispatch `runAttributionLane` even when
   `attribution_judge_cutover` is not armed. Non-verify-only residue behavior stays
   byte-identical to today (dark unless the global cutover is armed). The verifier either
   cites an existing satisfying commit — engine validates the citation (existence + ancestry,
   reusing the lane's validation) and writes the `semantic-verified` stamp — or abstains
   loudly (#519) into the retry hint. Stamps flip rows via the existing in-loop re-check, so
   progress, gate, and budget-reset all follow from existing machinery.
3. **Hook parity for `Evidence: skipped`.** The generated commit-msg hook accepts an empty
   commit carrying `Task: <id>` + `Evidence: skipped <reason>` (non-empty reason), matching
   what autoheal already derives from. Bare empty commits stay rejected.
4. **Park reason names the stranded ids.** When auto-park fires with verify-only tasks among
   the unresolved set, the park reason includes those task ids so the operator sees "stranded
   verify-only task" instead of a generic evidence failure.

## Alternatives considered

- **Trust the batch evaluator's APPROVE as completion evidence.** Rejected: violates #463
  (evidence stamps are the only completion currency precisely because the gate must distrust
  agent self-reports); an APPROVE is a batch-level self-report, not per-task grounded evidence.
- **Forbid commit-less GREEN tasks in `/plan`.** Rejected: forces fabricated code deltas or
  no-op edits to satisfy the gate — worse than the disease; prove-closed work is legitimate.
- **Arm `attribution_judge_cutover` globally.** Rejected here: that is the #520 rollout
  program's decision with a much larger blast radius (all residue classes); this spec needs
  only the verify-only class. The class-scoped predicate composes cleanly with a later global
  arming (it becomes a no-op).
- **Strengthen the /tdd empty-evidence-commit prose.** Rejected as primary fix: the protocol
  already exists at skills/tdd/SKILL.md:163-197 and the #667 session still skipped it. Prompt
  discipline is the failure mode (Design Principles; precedents #426, #433). The skill text is
  still updated (story 5) as documentation, not as the enforcement mechanism.

## Scope: #678 interaction

#678 (autonomous session stalls on the VERSION-bump prompt) is a downstream symptom of this
bug per its causality-correction comment: the retry loop re-invoked `/pipeline` on an
already-complete build, and the idle session escalated into `/finish`. This spec removes that
trigger for the verify-only class — the judged closure runs in-loop on the gate-miss branch
(no full `/pipeline` re-dispatch needed to clear the residue). The general #678 outcomes —
(a) a re-dispatched session on any completed build must not escalate into ship steps, and
(b) no autonomous session ever blocks on an approval prompt — are explicitly DEFERRED to
#678 / PR #679 and are NOT delivered by this spec.

## Consequences

- A verify-only task reaches completion without a fabricated delta, via either the authored
  empty evidence commit (preferred, now hook-passable in both trailer forms) or the judged
  stamp fallback when the session fumbles the protocol.
- An evaluator-APPROVED build with N-1/N commit-resolved tasks no longer auto-parks solely
  because one task is verification-only — unless the judge genuinely cannot substantiate it,
  which parks loudly with named ids (fail-closed preserved).
- The `0/N` progress symptom disappears as a side effect of rows flipping; no display change.
- Adds one LLM dispatch per stranded verify-only residue evaluation — bounded, and strictly
  cheaper than the 3 full-pipeline retries it replaces.
