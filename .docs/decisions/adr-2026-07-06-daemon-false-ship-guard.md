# ADR: finish push-evidence gate and daemon ship guard (no false ships)

**Status:** APPROVED (operator-approved 2026-07-06, engineer session)
**Date:** 2026-07-06
**Issue:** ai-conductor#337 (incident: #199 / PR #267)
**Related:** #367 (whitewash guard — evidence-based gating precedent), #290/#331 (silent
gh-failure family), #213/#281 (adjacent finish defects), #204/#205 (finishChoice added to
WorktreeOutcome but never consulted by the ship decision),
adr-2026-07-03-committed-shipped-record-dispatch-dedup, adr-2026-07-03-halt-pr-rehabilitation-at-finish

## Context

A daemon feature ran a full green pipeline for ~3 hours, converged `DONE`, and was marked
`{"status":"shipped","prUrl":null}` — while `origin/<branch>` never advanced and no PR was
recorded. The worktree was removed and the processed marker locks the feature done, so the
work is stranded unpushed and never re-dispatched (#337).

Verified defect chain (all confirmed by direct code read, 2026-07-06):

1. The engine never pushes on the success finish path — pushing is delegated to the `/finish`
   skill. The daemon auto-prompt (`step-runners.ts:639-668`) says: create a PR (or **reuse an
   existing PR's URL** via `gh pr view`), else fall back to writing `finish-choice=keep`.
2. The finish completion gate (`artifacts.ts:737-796`) passes `keep`/`merge-local`/`discard`
   with only a fresh choice marker — zero push/PR evidence. For `pr` it requires `pr_url`,
   but a **stale/pre-existing** PR URL (e.g. PR #267's early scaffold) satisfies it without
   any push. The loop therefore converges `DONE` for every finish choice by design
   (`readWorktreeOutcome` comment, `daemon-deps.ts:229-235`).
3. The daemon ship branch (`daemon-runner.ts:173-225`) gates on `outcome.done` alone. It
   parses `finishChoice` and `prUrl` into the outcome but consults neither before
   `markProcessed(slug, prUrl)` (`daemon-deps.ts:96-106` — writes
   `{status:'shipped', prUrl: prUrl ?? null}`) and worktree removal.

## Decision

Two independent guards plus a skill-side STOP gate (operator-selected Approach B):

### 1. Finish completion gate requires push evidence (engine, `artifacts.ts`)

For `finish-choice=pr`, the gate additionally requires **local push evidence**: HEAD is an
ancestor of the branch's remote-tracking ref (`git merge-base --is-ancestor HEAD
refs/remotes/origin/<branch>`). A successful push updates the local tracking ref without
network, so this check is **deterministic and offline** — no fail-open network hole (unlike
the halt-title gh check, which stays fail-open). Evidence is injected via `CompletionContext`
(new injectable, same pattern as #367's `getHeadSha`); when the injection is absent (no git,
legacy callers), the guard is skipped — fail-open preserves non-git environments.

In **daemon (auto) mode only**, `keep` and `merge-local` no longer converge `DONE`: the gate
returns incomplete with a reason naming the choice, routing to the normal
remediation/retry→HALT path. Interactive mode keeps today's semantics (keep/merge-local are
legitimate operator choices).

### 2. Daemon ship guard (engine, `daemon-runner.ts` done-branch)

The daemon writes a `shipped` processed marker **only** when `outcome.finishChoice === 'pr'`
AND `outcome.prUrl` is non-null. Any other done-outcome (null prUrl, keep/merge-local,
missing choice marker) is treated as a failed ship: write the HALT marker into the worktree's
`.pipeline` with a reason naming the contradiction, call `escalateBuildFailure` with the
worktree as cwd (pushes the branch and opens a draft `needs-remediation` PR — so even the
failure path preserves the work on origin), keep the worktree (`teardownWorktree(keep=true)`),
and report `halted`, **never** `done`. The **live ship path** (`markProcessed` from the
done-branch) can no longer write a `shipped` marker with a null `prUrl`.

*Scope note (amended during stories, 2026-07-06):* `repairProcessed` is exempt — it is a
cache repair driven by a committed shipped record already merged on the base branch, so the
ship is proven by independent evidence; its null `prUrl` only marks a malformed-but-proven
record and is legitimate.

### 3. Skill STOP gate (`skills/finish/SKILL.md` §5, Option 2)

After `/pr` runs and before writing `finish-choice=pr`: verify the PR URL is non-empty AND
the pushed branch's remote-tracking ref contains HEAD. On failure, do NOT write
`finish-choice`/`pr_url` — STOP (mirrors the existing §1b STOP-gate pattern).

## Consequences

- A gh/push failure in daemon mode now produces a kept worktree + HALT (+ best-effort
  remediation PR) instead of a silent `shipped/prUrl:null` lock. Escalation's own push can
  also fail (FR-7, silently swallowed) — the HALT marker and kept worktree still protect the
  work; only the *surfacing* degrades.
- A stale/reused PR URL whose branch never advanced no longer ships (gate evidence) and no
  longer writes a shipped marker (daemon guard) — the two guards fail independently.
- Daemon-mode `keep` stops being a legal terminal ship. Today `keep` is only produced in
  daemon mode as the auto-prompt's gh-failure fallback, so halting it is the correct
  semantics. Honest terminal statuses for intentional keep/discard (`parked`/`abandoned`)
  are deliberately out of scope — candidate follow-up.
- `CompletionContext` grows one injectable evidence reader; absent injection = legacy
  behavior (fail-open), so non-daemon/non-git callers are unaffected.
- `issue-ref.ts`'s "no implementation PR was recorded" skip becomes unreachable on the ship
  path (a ship now always carries a verified prUrl).

## Alternatives rejected

- **Daemon-only null-prUrl halt (A):** misses the stale-PR-URL variant (reused URL, branch
  unmoved) and leaves the evidence-free `DONE` convergence in the gate.
- **B + processed-marker status redesign (C):** honest `parked`/`abandoned` statuses touch
  dedup/rekick/isProcessed — scope creep for a bug fix; follow-up issue instead.
- **Network-based evidence (`git ls-remote`):** requires network at gate time and forces a
  fail-open path (the hole this ADR closes); local tracking-ref ancestry is sufficient
  because a successful push always advances it.
