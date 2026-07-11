# Conflict Check: Semantic Attribution Verification (#520)

**Date:** 2026-07-11
**New stories:** `.docs/stories/evidence-gate-validates-provenance-proxies-not-whe.md` (12)
**Scanned against:** all `.docs/stories/*.md`, attribution-stack ADRs
(2026-07-05 engine-owned-task-status, 2026-07-07 task-trailer-id-alias +
build-review-judgement-gate, 2026-07-09 deterministic-evidence-attribution-enforcement,
2026-07-10 session-hook-task-stamping + inline-work-attribution-enforcement), the
unmerged #469/#500 parallel-validation branch's ordering contract, and open issues
#501/#519/#510/#467/#445.
**Result:** PASSED — zero blocking conflicts. Two story-phrasing defects found during
pair verification were fixed in place (below). Two deliberate tensions adjudicated as
non-conflicts with notes.

## Fixed during the scan (story-phrasing, resolved in stories per §5c default)

1. **Story 12 #417 fixture was self-defeating.** As drafted (`Task: task-7`, "alias
   guard cannot apply"), main's guarded alias (`taskTrailerMatches`, autoheal.ts:82)
   would resolve it mechanically — no residue, nothing to replay. Reworded to an
   id-grammar variant outside both grammars (`Task: task-07`). Confidence: verified
   against the alias implementation and its ambiguity guard.
2. **Story 12 #501 fixture asserted an impossible precondition.** "Numeric task-status
   ids + commits with valid string trailers" resolves mechanically on main — the
   numeric-vs-string bug lives in the embedded hook scripts
   (git-hook-assets.ts:194, session-hook-assets.ts:109), not the derivation. Reworded
   to the incident's actual residue: work re-committed WITHOUT trailers after hook
   rejections. Confidence: verified (source explorer located both comparisons; #501
   issue text describes commit rejection).

## Adjudicated non-conflicts

- **(a) Story 1/5 "byte-identical when inert / all-refused" vs #509 zero-work-product
  kickback.** Compatible by construction: the lane is additive inside the gate-miss
  branch, runs only when new commits exist (zero-work tries skip it — Story 1 encodes
  #509's own negative path verbatim), and an all-refused lane run changes no counter or
  marker the #509 stories assert. The #509 story "completion check runs FIRST" ordering
  is upstream of the lane trigger and untouched.
- **(b) Story 12 #501 fixture vs open #501.** The story exercises the *symptom residue*
  and explicitly leaves the hook fix out of scope (lane ADR D10, growth-freeze D9 marks
  repairs as sanctioned). No duplication: #501's fix changes hook comparisons; Story 12
  changes nothing in the hooks.
- **(c) Spot-audit post-green dispatch vs #469 ordering contract** ("validation group
  strictly after build_review, no overlap" — unmerged branch conflict doc). The audit is
  telemetry, not a validation-group member: it gates nothing, joins nothing, and may run
  concurrently with build_review without touching its inputs/verdict. When #500 merges
  and the audit becomes a group member (spot-audit ADR D5), it inherits the group's
  ordering. **Degrading-tension note accepted:** until then, an audit session and the
  build_review grader may run concurrently in the same worktree — both are read-only
  over git history plus their own distinct output files, so no write contention exists
  (.pipeline/attribution-verdict.json vs .pipeline/build-review.json;
  audit results land in .daemon/attribution-accuracy.jsonl).
- **(d) Mechanical-lane growth freeze (lane ADR D9) vs in-flight specs.** Swept unmerged
  spec branches and the intake inbox: no pending spec adds a new attribution proxy
  surface (#500 = validation fan-out; retry-as-escalation = model policy; #474/#475 =
  dispatch policy). The freeze binds future intake routing, contradicts nothing queued.
- **(e) `conduct-ts evidence judge` vs #467's proposed `evidence backfill --verify`.**
  Coexistence by design: the CLI ADR reserves the `evidence` command group and covers
  the judge portion of #467; #467 remains open for halt-message UX and any pure-backfill
  (no-judge) recovery. No overlapping semantics, no duplicate command.

## Standard sweep (all 5 conflict types, all story pairs)

- **Contradiction:** none. The new stories never permit what an existing story forbids;
  every completion-currency assertion routes through the existing sidecar authority
  (consistent with adr-2026-07-05 H4/H7, adr-2026-07-09 D3, adr-2026-07-10).
- **Behavioral overlap:** build_review pairing checked explicitly — the judged lane
  stamps *attribution* upstream; build_review still grades *honesty* downstream and may
  FAIL a build whose tasks are all attributed. Both verdicts can hold simultaneously;
  rubrics are disjoint (Story 6 vs add-a-judgement-gate stories).
- **State conflict:** judged stamps + mechanical stamps coexist per-task-id in one Map —
  a task has exactly one stamp; forms never merge (verdict ADR: additive fields,
  immutable existing entries). No impossible state.
- **Resource contention:** `.pipeline` sidecars stay single-writer (engine in-loop; CLI
  refuses during active build — Story 10). Ledger is append-only JSONL with
  line-atomicity asserted (Story 9). `.pipeline/attribution-verdict.json` is written by
  the verifier session and read by the engine — same single-consumer pattern as
  `build-review.json`.
- **Sequencing:** lane strictly inside the build gate evaluation; audit strictly after
  gate-green; config read at startup (restart-to-apply, owner-gate precedent). No
  circularity: the lane consumes commits, never creates them.

## Verdict

Clean pass. Proceed to `/plan`.
