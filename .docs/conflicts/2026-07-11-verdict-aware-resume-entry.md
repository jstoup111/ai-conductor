# Conflict Check: Verdict-Aware Resume Entry (#532)

**Date:** 2026-07-11
**Feature stories:** .docs/stories/rekick-resume-runs-finish-while-the-build-gate-ver.md (4 stories)
**Result:** PASSED — zero blocking conflicts, zero degrading conflicts. One shared-file
build-sequencing note (operator-raised), documented below with mitigation.

## Story-vs-story scan

Pairs examined (verified against story text, not assumed compatible):

- **#300 `2026-07-05-rekick-gated-rebase-resolution`** — governs how `resumeRebaseFirst` routes a
  rebase *conflict* through the gated `/rebase` loop. #532's stories change nothing about conflict
  routing or rebase state recording (`recordRebaseStepCompletion` stays unconditional per ADR
  Option D rejection); they change only the downstream startIndex derivation. Compatible.
- **#516 family (pre-loop rebase state recording)** — #516 asserts the pre-loop rebase IS recorded
  as `done`; #532 Story 1 depends on exactly that recording existing and adds the verdict clamp
  after it. Complementary by design (the issue names this the "complementary failure").
- **`2026-07-09-daemon-merged-pr-guard-on-retry`** — its no-re-dispatch/finish-choice assertions
  fire at the daemon level BEFORE `conductor.run()` (early return, verified in daemon-cli.ts);
  #532's clamp lives inside `run()`. Disjoint control-flow. Compatible.
- **`unify-build-completion-evidence-derivation-fix-der` + #520
  `evidence-gate-validates-provenance-proxies-not-whe`** — these govern how `build.json` BECOMES
  satisfied (evidence derivation, attribution lane flipping the gate green in the same
  evaluation). #532 consumes whatever verdict is on disk at resume entry. Producer/consumer,
  not contention: the clamp honors a lane-satisfied verdict identically to any other. Compatible.
- **#532 Story 4 vs daemon re-dispatch expectations** (daemon-cli resume comment: re-dispatch
  "resumes at its real next step (e.g. prd_audit / finish)") — preserved verbatim by Story 4's
  all-satisfied parity scenarios. No prior story asserts a resume may IGNORE an unsatisfied
  verdict, so Story 1/2/3 contradict nothing.

## Sequencing note (operator-raised): shared conductor.ts across in-flight builds

| In-flight work | conductor.ts regions touched | Overlap with #532 seam |
|---|---|---|
| #520 (merged spec, builds first) | build gate-miss branch (attribution lane after `applyDerivedCompletion`, retry hints, spot-audit) | None semantic. Same file, disjoint regions (resume derivation ~run() entry + findResumeIndex; #520 edits the build-evaluation branch). |
| #529 spec PR (finish engine machinery) | completion-ctx regions (:1560-1571, :1805-1811, :1853-1855, :2209-2219 per its plan) | None semantic; disjoint regions. |
| #530 spec PR (engine-invoked attribution) | none (plan touches no resume/selector/gates files) | None. |
| #535 (cluster sibling, no spec yet) | rebase.ts evidence-stamp translation (per issue title) | Adjacent, complementary: #535 reduces how often file-changing rebases orphan evidence (fewer kickbacks); #532 makes resume honor whatever kickbacks exist. Its future spec should cite this report. |

**Type:** resource contention (textual, one file) — NOT a story conflict.
**Severity:** none at spec time; moderate merge-conflict likelihood at build time.
**Mitigation (accepted):**
1. Operator-locked build order (#520 → #530 → #535+#532) means #532 builds last; the daemon's
   build-time rebase absorbs the earlier merges, and the in-loop rebase kickback machinery —
   the very machinery this feature hardens — re-verifies after any file-changing rebase.
2. The #532 plan MUST reference insertion points structurally (function names / anchors like
   "the `startIndex` derivation in `run()`", "`findResumeIndex`"), never line numbers, so the
   plan survives #520/#529 landing first.

## Verdict

Clean pass. Proceed to `/plan` (with mitigation 2 as a binding plan-authoring constraint).
