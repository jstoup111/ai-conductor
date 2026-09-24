# Conflict Check: engine-owned destructive-git guard (#1354)

**Date:** 2026-09-23
**Stories checked:** `.docs/stories/destructive-git-prevention-is-absent-in-self-host.md` (Stories 1–12)
against about 480 existing story files in `.docs/stories/`.
**ADR corpus:** `repo_wide` (`.ai-conductor/config.yml`).
- **Examined:** all 317 `adr-*.md` files.
- **Narrowed to 28 whose subject overlaps these stories:** child env, provisioning failure policy,
  force push, self-host isolation, review containment, telemetry, and the GitHub-operation boundary.
- **Narrowed out:** the rest, which have no overlapping behaviour, entity or gate. No partially or
  ambiguously superseded ADR was excluded.

**Result:** 4 blocking conflicts found and resolved (operator-approved 2026-09-23). 5 non-blocking
items recorded. The re-check is clean.

## Blocking (resolved)

### Conflict: a truthful report of a guard refusal is refuted as a fabricated blocker

**Stories involved:** #1298 environment-claim refutation vs New Story 1 / Story 5
**Files:** [.docs/stories/stop-refuting-blanket-environment-denial-claims-th.md] vs [.docs/stories/destructive-git-prevention-is-absent-in-self-host.md]
**Type:** oscillating
**Severity:** blocking

**Description:**
- The #1106 audit refutes any Claude self-host claim that the environment blocked `git push`. It
  rests on the premise, in `self-host/environment-claim-audit.ts`, that "the only environmental
  control installed for it is the write fence".
- Once the guard refuses `git push --force`, an agent that reports that truthfully has its attempt
  failed, and its retry hint says the push is unfenced.
- Satisfying either story's criteria breaks the other's premise.

**Resolution Options:**
1. Teach the audit that a bare force push is a guard-refused form. Claims naming it are not
   refuted, and plain or lease `git push` and `gh` claims are still refuted.
2. Exempt every `git push` claim while the guard is present.
3. Drop force-push from the guard.

**Recommendation and resolution:** Option 1 (applied). New Story 12, plus an additive amendment to
adr-2026-09-23-engine-git-guard-on-agent-path decision 6.

### Conflict: the smoke cleanup's `branch -D` is refused, leaking a branch per run

**Stories involved:** #334 bin/setup-worktree smoke vs New Story 2 / Story 4
**Files:** [.docs/stories/reenable-bin-setup-worktree-smoke.md] vs [.docs/stories/destructive-git-prevention-is-absent-in-self-host.md]
**Type:** contradiction
**Severity:** blocking

**Description:**
- #334 requires its `finally` block to delete the smoke branch with `git branch -D`
  (`test/smoke/publish-interrupted.smoke.test.ts`, created with `worktree add -b` at `HEAD` in the
  root checkout).
- The original Story 2 refused `-D` of any branch that is not an ancestor of the default branch. In a
  guarded shell the delete is refused, the error is swallowed, and a branch leaks on every run.
- The same rule also disagreed with parked-feature reconciliation (#1060) when local `main` lags
  `origin/main`.

**Resolution Options:**
1. Refuse `-D` only when the branch tip is not reachable from any other local branch or
   remote-tracking ref, which is exactly when commits would become unreachable.
2. Change the smoke test's cleanup to avoid `-D`.
3. Exempt the root checkout from the guard.

**Recommendation and resolution:** Option 1 (applied). Story 2 was rewritten in place. There are
additive amendments to adr-2026-09-23-engine-git-guard-on-agent-path decision 5 and to the
architecture refusal matrix.

### Conflict: the live smoke skip policy contradicts gate mode

**Stories involved:** #927 release-time smoke gate vs New Story 11
**Files:** [.docs/stories/no-release-time-smoke-or-eval-gate-releases-cut-wi.md] vs [.docs/stories/destructive-git-prevention-is-absent-in-self-host.md]
**Type:** contradiction
**Severity:** blocking

**Description:**
- #927 requires gate mode to fail, not skip, when a selected credentialed leg lacks credentials.
  It also requires each smoke file to declare one capability.
- The original Story 11 skipped unconditionally.

**Resolution Options:**
1. Use one `credentialed:claude` and one `credentialed:codex` guard smoke file. They skip in
   advisory mode and fail in gate mode.
2. Put both providers in one file.
3. Leave the live proof outside the smoke runner.

**Recommendation and resolution:** Option 1 (applied). Story 11 was rewritten in place.

### Conflict: the TDD counterfactual's temporary worktree is itself guarded

**Stories involved:** New Story 10 vs New Story 3 / Story 4
**Files:** [.docs/stories/destructive-git-prevention-is-absent-in-self-host.md] (internal)
**Type:** contradiction
**Severity:** blocking

**Description:** a temporary worktree of the feature repository shares its git common dir. Any path
discard used there is refused.

**Resolution Options:**
1. Create the temporary worktree at the base commit and copy only the test files in, with no
   discard anywhere.
2. Exempt temporary worktrees.

**Recommendation and resolution:** Option 1 (applied). Story 10 was rewritten in place.

## Non-blocking (recorded, no story change)

- **Fail-open provisioning vs Story 7 fail-closed.** The stories concerned are:
  `deterministic-evidence-attribution.md` S6, `inline-build-work-commits-unattributed-session-hoo.md`
  TS-4, `engine-invoked-task-attribution-494-freezes-curren.md`, and
  `missing-session-hook-files-terminally-halt-a-build.md` TI-4.
  - **ADR filename stem:** adr-2026-07-10-inline-work-attribution-enforcement
  - **Story ID:** Story 7
  - **ADR opposing sentence (verbatim):** "All new hook installation follows #452/#494: provisioning failure degrades to today's behavior — enforcement machinery must never block worktree provisioning."
  - **Story opposing sentence (verbatim):** "**Given** worktree preparation whose guard write fails, **When** preparation runs, **Then** preparation fails with a message naming the guard, instead of logging a skip and continuing."
  - **Disposition:** already settled per asset by the later adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts: "Correct for attribution telemetry; wrong once the same directory carries a required preventive control […] Wiring failure must fail the step."
  - The guard is a preventive control, not attribution machinery, and the fail-open stories keep
    their scope. Degrading at most. Accepted.
- **adr-2026-07-03-post-rebase-force-with-lease.** Its containment rule governs engine force call
  sites. The guard adds none and only lets agent lease pushes through, as the operator confirmed on
  2026-09-23. No conflict.
- **`make-daemon-build-push-pr-timing-a-configurable-st.md` Done When:** "`--force-with-lease`
  appears at exactly one call site". This is already false on main (`autoresolve.ts`,
  `ship-draft-pr.ts`), and no test enforces it. The guard's refusal text is not a call site. Stale;
  no change.
- **`block-bare-force-pushes-inside-compound-commands.md` (#2159) vs Story 9.** They are compatible
  as long as heredoc detection requires a `<<«DELIM»` opener and scanning resumes after the closing
  delimiter. Story 9's negative path already pins the resumption.
- **Plan obligations, not story conflicts:**
  - `handle-runtime-values-as-literal-data-across-inter.md` (#1478): the guard asset joins the
    generated-asset validation inventory, and the real-git path is embedded as data.
  - The self-host release gate (`self-host-release-gate-bin-conduct-breaking-surfac.md`): the
    `hooks/claude/` edit needs a waiver or a migration block (review condition C4).

## Re-check

After the resolutions, each pair sharing a behaviour, file or gate was re-tested in both directions:
- Story 12 vs #1298: plain and lease push claims are still refuted.
- Story 2 vs #334 and #1060: a branch reachable from another ref is deletable.
- Story 11 vs #927: capability-declared per provider, and gate mode fails.
- Story 10 vs Stories 3 and 4: no discard anywhere.

No blocking conflict remains.
