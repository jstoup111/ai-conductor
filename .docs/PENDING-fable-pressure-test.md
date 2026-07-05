# PAUSED — resume on a Fable session

**Status:** DECIDE in progress, **paused** pending a Fable-model design validation.
**Date paused:** 2026-07-05
**Why paused:** the ownership-inversion design was pressure-tested under **Opus**, but the operator
requires **Fable** to validate it. Fable usage was expired at pause time; resume in a new Fable
session.

## Resume coordinates

- **Idea (from GitHub intake):** "prd-audit kickback wipes task-status.json, causing a build-step HALT
  loop that only manual reconstruction can break."
- **sourceRef:** `jstoup111/ai-conductor#302` — carry this into `land --source-ref` and
  `handoff --source-ref` when the spec finally lands.
- **Target repo:** `james-stoup-agents` (remote `git@github.com:jstoup111/ai-conductor.git`).
- **Worktree:** `.worktrees/engineer-prd-audit-kickback-wipes-task-status-json-causing-`
- **Branch:** `spec/prd-audit-kickback-wipes-task-status-json-causing-`
- **Slug:** `prd-audit-kickback-wipes-task-status-json-causing-`
- **Consistent artifact stem:** `prd-audit-kickback-preserves-task-status`
- **Tier:** Large (technical track, no PRD).

## IMPORTANT — do NOT re-`claim`

`conduct-ts engineer claim` already dequeued `#302` (ledger advanced to `claimed`). A fresh
`conduct-ts engineer` launcher will `claim` the **next** idea, not this one. To resume THIS work,
**skip the claim** — check out this worktree/branch directly and continue from the step below. Do not
start a new idea in the same session.

## What is already authored (on disk + committed to the spec branch)

- `.docs/track/prd-audit-kickback-preserves-task-status.md` — Track: technical.
- `.docs/complexity/prd-audit-kickback-preserves-task-status.md` — Tier: L.
- `.docs/architecture/prd-audit-kickback-preserves-task-status.md` — before/after diagrams
  (engine-owned, git-derived design).
- `.docs/decisions/architecture-review-prd-audit-kickback-preserves-task-status.md` — the pressure-test
  report (run under Opus). Outcome: PROPOSED, pending Fable.
- `.docs/decisions/adr-2026-07-05-engine-owned-task-status.md` — the decision. **Status: DRAFT**
  (intentionally — the `land` ADR gate will refuse to ship until Fable flips it to APPROVED).

## The design under validation (one-paragraph summary)

Invert ownership of `.pipeline/task-status.json`: the **engine** becomes its single writer — it
**seeds** the file from the plan at build entry (merge/upsert by task id, preserving status + rework
counts; never empty, never a blind overwrite), the build agent only **implements + commits with a
`Task: <id>` trailer**, and the engine **derives** per-task completion by matching those id-stamped
commits (promoting `autoheal` to authoritative, tightened to require the id — no shared-path
ambiguity). Remediation **extends the plan** with deterministic gap/FR-derived ids (idempotent
upsert). A wipe becomes structurally impossible and the completion gate decouples from `/pipeline`.
Binding constraints H1–H4 + the empty-is-done removal, no-false-positive-on-fresh-build, retained
#115 retryReason, and a survivable auto-park last-resort reconciled with #280 — all in the ADR.

## Next steps (in order) for the Fable session

1. **Re-run the design pressure-test on Fable** (inline in the main Fable loop, or via `fork`
   subagents which inherit the session model). Attack the ownership-inversion design and H1–H4
   specifically. If Fable's findings differ, update the ADR + review report accordingly.
2. **Flip the ADR to `Status: APPROVED`** only once Fable is satisfied (and remove this file's DRAFT
   block, or delete this file).
3. `/stories` → `.docs/stories/prd-audit-kickback-preserves-task-status.md` (must end
   **Status: Accepted**). Cover: seed merge/upsert (happy + preserves rework counts + idempotent
   re-seed), git-derived completion via `Task: <id>` trailer (+ path fallback + park-not-loop after N),
   remediation-extends-plan idempotency, empty/missing-plan park, `buildRetryHint` `'no tasks'`/
   `'missing'` cases, no-false-positive on a fresh build (0 commits since merge-base), single-authority
   migration of in-flight `task-status.json`, and #115 no-regression.
4. `/conflict-check` → `.docs/conflicts/` — check against #280 (survivable/forward-progress park),
   #115, `daemon-rekick.ts` FR-9, and the `/pipeline` + `/remediate` SKILL.md contract changes.
5. `/plan` → `.docs/plans/prd-audit-kickback-preserves-task-status.md`, **sequenced** as: Slice 1
   loop-and-wipe elimination (engine seed+merge+derive + remove empty-is-done + retry-hint) →
   Slice 2 remediation-extends-plan + single-authority migration → Slice 3 survivable auto-park
   (reconciled with #280).
6. `conduct-ts engineer land --project james-stoup-agents --idea "<idea>" --worktree <this worktree>
   --source-ref jstoup111/ai-conductor#302`, then `conduct-ts engineer handoff ... --source-ref
   jstoup111/ai-conductor#302`.

## Reference: relevant code (verified 2026-07-05)

- Build always dispatches `/pipeline`: `src/conductor/src/engine/step-runners.ts:35` (`build: '/pipeline'`).
- Completion gate: `src/conductor/src/engine/artifacts.ts:376-417` (empty → `'no tasks'` forever).
- Kickback sites: `src/conductor/src/engine/conductor.ts:1444-1538` (agentic ~:1472, deterministic
  ~:1520-1529); `buildRemediationHint` :2633-2649; `buildRetryHint` :2662-2674 (only matches
  `/tasks? not completed/`).
- Engine git-derived completion (to promote): `src/conductor/src/engine/autoheal.ts:58-104`,
  `readPlanPaths` :208, `findMatchingCommit` :292.
- Re-kick sweep + park survival: `src/conductor/src/engine/daemon-rekick.ts:90-190` (clears HALT,
  skips `isOperatorParked`); `park-marker.ts` (`.daemon/parked/<slug>`).
- Skill contracts to change: `skills/pipeline/SKILL.md` (Entry Guard :45-57 `all([])===true`; writer
  :66,78,84,128), `skills/tdd/SKILL.md` (writes nothing to task-status.json today),
  `skills/remediate/SKILL.md` (emits informational `remediation.json`).
