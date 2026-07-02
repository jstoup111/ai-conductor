# Plan: Engineer Worktree Isolation

**Date:** 2026-06-30
**Tier:** L
**Spec:** `.docs/specs/2026-06-30-engineer-worktree-isolation.md`
**Stories:** `.docs/stories/engineer-worktree-isolation.md`
**ADR:** `.docs/decisions/adr-2026-06-30-engineer-worktree-authoring-isolation.md` (APPROVED)

Test-first (TDD RED→GREEN). Tasks are 2–5 min units. External-git behavior gets a **real-git smoke
test**, never injected-runner argv alone (injected-runner-needs-real-binary lesson).

**Resolved open questions (from architecture-review):**
- *Lifecycle ownership:* a new deterministic `conduct-ts engineer worktree` primitive **creates** the
  per-idea worktree (so the skill can author in it before `land`); `handoff` **removes** it on
  success; failure leaves it. `land`/`handoff` gain a `worktreePath` (cwd) parameter.
- *Naming:* engineer worktree dir is `engineer`-scoped (e.g. `.worktrees/engineer-<slug>`) — disjoint
  from the daemon's, on branch `spec/<slug>`.

## Task Dependency Graph

```
T1 ─┬─ T2 ─ T3 ─┐
    ├─ T4 ─ T5 ─┼─ T8 ─ T9 ─ T10 ─ T11 ─ T12
    └─ T6 ─ T7 ─┘
```

## Phase 1 — Shared worktree helper (parity)

### T1 — Extract a shared worktree create/teardown helper
- **Dependencies:** none
- Lift the create/reconcile/`remove --force` logic from `daemon-deps.ts:createWorktree` (the three
  cases: fresh branch+dir; branch exists → attach worktree; teardown) into a shared module both the
  daemon and the engineer import. Engineer-scoped path + derived default branch
  (`git symbolic-ref refs/remotes/origin/HEAD`).
- **Tests:** unit — fresh create; leftover-branch-no-worktree reattach (FR-11); dirty-leftover
  surfaced not silently reused (FR-11 negative); teardown `--force`. Daemon path still green (no
  behavior change for it).

## Phase 2 — `land` commits in the worktree

### T2 — Thread `worktreePath` into `landSpec`; delete the checkout-dance
- **Dependencies:** T1
- Add `worktreePath` to `landSpec`; set every `cwd` to it; **remove** `git checkout -b … / checkout
  back` (land-spec.ts:208,243) — the branch already exists as the worktree branch. Keep
  `target.canonicalPath` as the AuthoringGuard root, re-rooted at the worktree `.docs/`. Scope
  staging to the idea's `.docs/` (no `add -A` of foreign files) — FR-9.

### T3 — `land` tests (worktree)
- **Dependencies:** T2
- Commit contents per tier (S and L) — FR-3; tier/stub/DRAFT/DRAFT-ADR rejections still fire — FR-3
  negative; foreign untracked file NOT committed — FR-9 negative; primary tree never `checkout`ed —
  FR-2 (assert recorded git argv).

## Phase 3 — `handoff` operates in the worktree

### T4 — Thread `worktreePath` into `openSpecPr`/`runHandoff`; push when remote; remove on success
- **Dependencies:** T1
- cwd = worktree for `gh pr create --head spec/<slug>`; `git push` when a remote exists; no-remote
  local-commit fallback unchanged; **record the authored-ledger key on the no-remote branch too**
  (alternate-branch side-effect invariant). On success, call the helper teardown (remove); on
  throw, leave the worktree.

### T5 — `handoff` tests (worktree)
- **Dependencies:** T4
- PR-open argv+cwd at worktree → same reported URL — FR-4; no-remote path records ledger key — FR-4
  negative; no-PR-URL errors but preserves branch+ledger; nudge failure non-blocking; remove-on-
  success leaves `spec/<slug>` reachable (incl. local-only) — FR-5; removal-failure reported — FR-5
  negative.

## Phase 4 — Engineer primitive + CLI + skill

### T6 — `conduct-ts engineer worktree` create primitive + CLI dispatch
- **Dependencies:** T1
- New subcommand resolves the target canonical path, calls the shared helper, prints
  `{ slug, branch, worktreePath }`. Wire `land`/`handoff` CLI dispatch to accept + forward
  `--worktree`. **Strict-abort** (FR-7): worktree-create failure (incl. zero-commit/unborn HEAD)
  throws with a clear message and zero primary-tree mutation — no seed commit, no fallback.

### T7 — Lifecycle wiring: strict-abort + remove-on-success / keep-on-failure
- **Dependencies:** T6
- **Tests:** strict-abort leaves repo byte-for-byte unchanged (HEAD/refs/status) — FR-7; zero-commit
  repo aborts without seeding — FR-7 negative; keep-on-failure retains worktree + reports path —
  FR-6; remove-on-success — FR-5.

### T8 — Update `skills/engineer/SKILL.md`
- **Dependencies:** T3, T5, T7
- Step 3 authors in the per-idea worktree (cwd = worktree), not the primary checkout; add the
  create-before-DECIDE call, strict-abort contract, remove-on-success/keep-on-failure, retained-path
  reporting; update the branch-policy note to the worktree flow. Run `test/test_harness_integrity.sh`.

## Phase 5 — Invariant & smoke tests

### T9 — Primary-tree-untouched invariant (FR-2)
- **Dependencies:** T8
- Capture primary `HEAD` ref + `git status --porcelain` before; assert byte-equal after a successful
  cycle, after a failed `land`, and after an abort. Dirty-primary-tree case preserved (FR-2 negative).

### T10 — Concurrent-actor non-corruption (FR-8)
- **Dependencies:** T9
- Two per-idea worktrees in one repo → each `spec/<slug>` commit is idea-scoped (no cross-bleed);
  a daemon-worktree-present fixture shows the engineer cycle leaves the daemon worktree + primary
  tree untouched. Sibling repo byte-unchanged across success/failure/abort (FR-10).

### T11 — Real-git smoke test of the worktree lifecycle
- **Dependencies:** T10
- A throwaway real git repo: create worktree → write `.docs/` → land → handoff (no-remote) → remove;
  assert worktree gone, `spec/<slug>` reachable, primary tree untouched. Real `git`, not injected.

## Phase 6 — Docs, changelog, integrity

### T12 — Docs + CHANGELOG + final validation
- **Dependencies:** T11
- Update the engineer sections of `README.md` and `src/conductor/README.md` (worktree authoring +
  abort/cleanup contract); add a CHANGELOG `[Unreleased]` entry; confirm
  `test/test_harness_integrity.sh` and the conductor vitest suite are green.

## Done / Acceptance

- All 11 FRs have passing tests, including the FR-2/FR-7/FR-8 invariants and the real-git smoke test.
- The shared-checkout `checkout -b … / checkout back` dance is deleted from `landSpec`.
- ADR-008 cross-reference + the new ADR are committed; docs + CHANGELOG updated; integrity green.
