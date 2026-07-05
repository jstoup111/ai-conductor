# ADR: Auto-resolve base-ignored build-artifact delete/modify conflicts (composed with CHANGELOG), and safely recover an orphaned unmerged index

**Date:** 2026-07-05
**Status:** APPROVED
**Feature:** Daemon auto-resolve gitignored build-artifact rebase conflicts
**Related:** adr-001-rebase-insertion-mechanism (writeHalt / no-dispatch keystone; the
SATISFIED-iff-current property), FR-7 (CHANGELOG-sole auto-resolution precedent),
FR-9 (preexisting-conflict guard), `resolveRebaseConflicts` loop shape (`rebase.ts:542`)
**Source:** jstoup111/ai-conductor#319
**Revised:** 2026-07-05 after adversarial review (stage-inversion, ignore-mechanism,
orphaned-index reset target, CHANGELOG composition, multi-commit recurrence).

## Context

The engine-native `rebase` loopGate (`performRebase`, `rebase.ts:350`) auto-resolves exactly one
conflict class: `CHANGELOG.md` as the SOLE conflicted path (`rebase.ts:419`,
`tryResolveChangelogConflict` `:478`). Every other conflict falls to `conflict_halt` and re-parks.

Three `needs-remediation` PRs (#267/#268/#269) stranded on the SAME mechanical conflict: their
branches predate PR #303/#309, which **untracked `src/conductor/dist`** (gitignored at root
`.gitignore:12`). Rebasing onto current `main` produces a **delete/modify conflict** — the base
deleted the path; the branch still modifies it — and, for #268/#269, a `CHANGELOG.md` conflict **at
the same time**. Each re-kick re-parks forever; only manual `git rm --cached` + rebase unblocks it.

A compounding failure: an aborted/interrupted re-kick can leave an **orphaned unmerged index**
(unmerged paths, no `rebase-merge`/`rebase-apply` dir), which makes the preexisting-conflict guard
(`rebase.ts:369-378`) return `conflict_halt` ("rebase already in progress") on every subsequent
re-kick even though no rebase is active — dead-locking the feature.

## Decision

### 1. New conflict class — base-ignored delete/modify, composed with CHANGELOG, looping to completion

Inside `performRebase` (in `performRebase` proper, NOT the cap-gated `/rebase` loop — the re-kick
path passes `cap: 0`), after the CHANGELOG-sole branch, add a resolver that handles a conflict set
partitioned into two auto-resolvable classes, and loops over successive rebase pauses:

- **base-ignored artifact deletion.** A path qualifies iff BOTH:
  - the unmerged stages show **"deleted by us" (DU)** for that path — i.e.
    `git ls-files -u -- <path>` shows **stage 2 absent AND stage 3 present**. During a rebase the
    base rebased ONTO is stage 2 (`:2:`/ours) and the replayed feature commit is stage 3
    (`:3:`/theirs) — the SAME inversion documented at `rebase.ts:478-484`. "Base deleted, branch
    modified" is therefore *stage-2-absent, stage-3-present*, NOT the inverse. The inverse (stage 3
    absent = feature deleted a path the base still modifies) is a real-source drop and MUST NOT
    qualify.
  - the path is **base-ignored** per the predicate in §2.
- **CHANGELOG `[Unreleased]`** — the existing safe take-base-and-re-append resolution
  (`buildResolvedChangelog`), reused so a set of {CHANGELOG + base-ignored artifacts} resolves as a
  whole. This is the actual #268/#269 case.

Algorithm: at each rebase pause, take the current unmerged set. If EVERY path is in one of the two
classes, resolve each (`git rm` the qualifying DU artifact paths; write the resolved CHANGELOG and
`git add` it), `git rebase --continue`, and repeat at the next pause. Because a build artifact like
`dist` is modified across MANY feature commits, `--continue` will pause again on the next commit
that touches it — the loop re-qualifies and re-resolves until the rebase completes. Bound the loop
by a sane max-iteration cap; exceeding it → `conflict_halt`.

The completed rebase returns a new `RebaseOutcome` variant `artifact_resolved`, **verdict-equivalent
to `changelog_resolved`** (artifact/docs-only; `rebase` gate SATISFIED; downstream NOT invalidated —
a gitignored artifact is never built/tested).

### 2. Base-anchored ignore predicate that git's own engine evaluates (no ref-ignore hand-rolling)

`git check-ignore` consults the WORKING TREE's ignore files, which at a paused rebase are base's
`.gitignore` **with replayed feature commits layered on** — so a feature commit that edited
`.gitignore` could launder a real path into "ignored". Close this precisely:

- **Disqualifying guard:** if `git diff --name-only <base>..HEAD` includes ANY `**/.gitignore`
  path (the branch modified ignore rules relative to base), the WHOLE conflict set is disqualified →
  `conflict_halt`. Fail-closed; the branch cannot alter the ignore boundary.
- **When the branch did not touch any `.gitignore`,** the working-tree ignore state equals base's,
  so `git check-ignore -q -- <path>` is a faithful base-ignore test — and it natively honors
  **nested** `.gitignore` files, negation, and precedence (which a hand-rolled `git show
  base:<dir>/.gitignore` parser would get wrong). This is the ignore mechanism.
- A `check-ignore` that errors (non-0/1 exit) → treat as NOT ignored (fail-closed) → HALT.

### 3. All-or-nothing over the conflict set

If any conflicted path at any pause is in NEITHER auto-resolvable class — a non-ignored path, a
modify/modify, a feature-deleted (DA) path, a real source file — the whole set is disqualified and
`performRebase` falls through to `conflict_halt`. The resolver never partially resolves.

### 4. Orphaned unmerged-index recovery — reset to the FEATURE TIP, never to detached base

Split the preexisting-conflict guard (`rebase.ts:369-378`) on `rebaseStateActive()`:

- `rebaseStateActive() === true` → **keep re-parking** (`conflict_halt`). A live rebase is never
  reset.
- `rebaseStateActive() === false` AND unmerged paths present → an **orphaned index**. Recovery MUST
  restore the feature commits, not the base tree: an aborted rebase can leave HEAD **detached at the
  base** (`rebase.ts:363-368`), so a naive `git reset --hard HEAD` would reset to the *base tree*,
  discard the feature commits (reachable only via the branch ref), and then make `isBranchCurrent`
  read `HEAD..base == 0` → **noop → SATISFIED** — the exact ADR-001 stale-branch-ships bug.
  Instead: re-checkout the **feature branch** (or reset `--hard` to `ORIG_HEAD` / the branch tip),
  clearing the stale unmerged entries, THEN fall through to the normal flow so `isBranchCurrent`
  runs against the feature branch and a genuinely-behind branch actually rebases. After recovery the
  code path re-derives the base and rebases exactly as a fresh run; the standard post-rebase
  guards (`isBranchCurrent`, and `featureCommitsPreserved` in the resolver loop) still apply, so a
  recovery that lost commits cannot report SATISFIED.

## Consequences

- **Positive:** the whole backlog of pre-#303 branches self-resolves the `dist` conflict — including
  the {dist + CHANGELOG} composite that #268/#269 actually hit — with zero operator action, across
  multi-commit branches.
- **Positive:** an orphaned-index re-kick recovers itself without dead-locking, and without ever
  false-satisfying (reset target is the feature tip, not detached base).
- **Positive:** reuses git's native ignore engine and the existing CHANGELOG resolution; ADR-001's
  SATISFIED-iff-current keystone is preserved.
- **Negative / risk:** a bug in stage detection or the ignore predicate could drop real source.
  Mitigated by pinned DU-stage detection, the branch-touched-`.gitignore` disqualifier, all-or-
  nothing, and mandatory negative-path stories (non-ignored delete/modify HALTs; feature-deleted
  DA HALTs; branch-modified-`.gitignore` HALTs; mixed set HALTs whole).
- **Negative / risk:** the recovery reset discards worktree state — bounded to the inactive-rebase
  branch and targeted at the feature tip, guarded by the post-rebase preservation checks.

## Alternatives rejected

- **Widen to any delete/modify:** unsafe — silently drops real source. The base-ignored + DU-stage
  predicate is the minimal safe boundary.
- **Hand-roll base-ref ignore via `git show base:<dir>/.gitignore`:** re-implements nested-gitignore
  precedence + negation, which is error-prone; using native `check-ignore` behind a
  branch-didn't-touch-`.gitignore` guard is both correct and simpler.
- **Single `git rm` + one `--continue`:** strands every multi-commit branch (dist re-conflicts on
  the next replayed commit). The loop-to-completion is required.
- **Reset orphaned index to `HEAD`:** false-satisfies when HEAD is detached at base — reset to the
  feature tip / `ORIG_HEAD` instead.
- **Resolve inside the gated `/rebase` loop:** the re-kick path passes `cap: 0`; it would never run.

Operator absent — host engineer APPROVED, 2026-07-05, with pinned DU-stage detection, the native-
`check-ignore` + `.gitignore`-untouched predicate, loop-to-completion, CHANGELOG composition, and
the feature-tip reset target as non-negotiable safety conditions.
