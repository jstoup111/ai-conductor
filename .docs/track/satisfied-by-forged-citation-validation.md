# Track: satisfied-by-forged-citation-validation

**Source:** jstoup111/ai-conductor#533 (evidence-integrity / security-adjacent)
**Track:** technical
**Status:** Accepted

## Why technical (not product)

This is an engine correctness/security defect in the conductor's build-completion
(evidence) gate. There is no user-facing feature surface, no new product requirement,
and no acceptance criteria a product owner would author. The observable is entirely
internal to the SDLC machinery: the mechanical evidence lane stamps a task complete
from a **forged** `Evidence: satisfied-by <sha>` citation. Acceptance signals are
expressed as engine behavior + tests, so `/prd` is skipped and stories are derived
from the technical intent.

## Problem statement (WHAT, not the filer's HOW)

The mechanical evidence lane accepts an `Evidence: satisfied-by <sha>` citation on the
sole basis that the cited object **exists in the git object database**
(`git rev-parse --verify <sha>^{commit}`). No ancestry check, no non-empty check, no
check that the cited diff has anything to do with the task's declared work. On the #520
build branch this let an **empty commit** citing a **dangling pre-rebase object** (kept
alive by a reflog, not an ancestor of HEAD, whose actual diff was an unrelated docs
sweep) falsely mark task 24 complete and count toward the build gate — contributing to
the #520 near-false-ship.

The defect is that completion is supposed to be *derived* from genuine implementing
commits, but for the `satisfied-by` form the derivation accepts an **unfalsifiable
citation**: any sha that ever existed anywhere in the repo passes.

### Verified defect site (read directly in worktree)

`src/conductor/src/engine/autoheal.ts:619-643` (`deriveCompletionInternal`, the
`satisfiedByTrailer` branch):

```ts
const shaCheck = await execa('git', ['rev-parse', '--verify', `${sha}^{commit}`], { cwd: projectRoot, reject: false });
if (shaCheck.exitCode === 0) {
  result[taskId].completed = true;   // ← object-existence is the ONLY gate
  ...
```

`rev-parse --verify` succeeds for ANY object in the odb — including pre-rebase
originals kept alive by reflogs — so the "dangling sha" else-branch
(`autoheal.ts:635-641`) never fires for exactly the commits most likely to be cited by
accident or forgery after a rebase.

## The genuine-corroboration gap (grounded, not the filer's sketch)

The engine **already has** the correct check, applied in two sibling contexts but NOT
to the mechanical `satisfied-by` form:

1. **Judged lane** — `src/conductor/src/engine/attribution-validate.ts:116-191`
   (`validateCitations`) runs a 5-check pipeline per citation: reachability →
   **ancestry (`git merge-base --is-ancestor`, line 143)** → **non-empty (`git
   diff-tree --quiet`)** → not-bookkeeping → **path overlap (`fileMatchesPlanPath`)**
   against the task's declared Files. Governed by APPROVED
   `adr-2026-07-11-semantic-attribution-verification-lane.md`.
2. **Mechanical `Task:` trailer form** — `autoheal.ts:683-717` already rejects empty
   commits and requires path overlap (`filesOverlappingTaskPaths`) against the plan
   task's Files.

The `satisfied-by` form (`autoheal.ts:619-643`) is the **one lane that skips all of
this**. The fix extends the already-approved provenance rule to it: a `satisfied-by`
citation stamps only when the **cited** commit is an ancestor of HEAD, non-empty, and
(if the task declares Files) its diff overlaps them. This is a design-conformance
extension of an existing APPROVED ADR, not a new mechanism — deterministic, git-derived,
no prompt discipline (satisfies the repo's deterministic-first design principle).

## Desired outcomes (observable, from #533)

1. A `satisfied-by` citation stamps a task only when the cited commit **is an ancestor
   of HEAD** AND (if the task declares Files) its diff **overlaps** the task's declared
   Files.
2. A forged/empty/off-branch-cited stamp attempt is **observably refused**: the task
   stays incomplete and a log/audit line names the commit, the cited sha, and the
   reason (non-ancestor / empty / no file overlap).
3. Legitimate backfills — an empty citing commit whose cited sha is a real on-branch
   work commit whose diff covers the task's Files — **still stamp exactly as today**.

## Scope decision — no new operator-marker escape hatch (see assumption ledger)

#533's Hypotheses float an "operator-marker escape hatch" to bypass the overlap check.
**Verified:** no such grammar exists in the codebase — the only `Evidence:` forms are
`satisfied-by <sha>` and `skipped <reason>` (grep of `src/engine/*.ts`). Desired outcome
#3 does NOT need an escape hatch (the cited commit passes overlap on its own). Adding a
new bypass surface to a security-critical gate would be scope creep and a new forgery
vector. This spec therefore does **not** introduce an operator-marker bypass; it only
extends the ancestry+non-empty+overlap rule. Recorded as an assumption for operator
review before land.
