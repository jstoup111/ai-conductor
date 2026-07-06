# Stories: daemon-false-ship-guard (ai-conductor#337)

**Status:** Accepted
**Track:** technical · **Tier:** M · **ADR:** adr-2026-07-06-daemon-false-ship-guard.md

---

## Story 1 — finish gate requires push evidence for choice=pr

As the engine, I refuse to converge `DONE` on a `pr` finish whose branch was never pushed,
so a recorded PR URL alone can't fake a ship.

- **Happy:** Given a worktree where HEAD is an ancestor of `refs/remotes/origin/<branch>`
  (push succeeded) and a fresh `finish-choice=pr` with `pr_url` set, When the finish
  completion gate runs with the push-evidence injectable present, Then the gate passes.
- **Negative (stale reused PR URL, unmoved branch):** Given `pr_url` set (e.g. a reused
  pre-existing PR) but `refs/remotes/origin/<branch>` does NOT contain HEAD, When the gate
  runs, Then it returns incomplete with a reason naming the missing push evidence (branch +
  what was checked), and `DONE` is not written.
- **Negative (no tracking ref at all):** Given a branch that has never been pushed (no
  `refs/remotes/origin/<branch>`), When the gate runs with the injectable present, Then it
  returns incomplete with the push-evidence reason (not a crash, not a pass).
- **Negative (missing injectable = legacy fail-open):** Given a caller that does not thread
  the push-evidence injectable into `CompletionContext` (non-git environment, legacy tests),
  When the gate runs on `choice=pr` with `pr_url` set, Then the evidence check is skipped and
  behavior is byte-identical to today (same contract as #367's `getHeadSha` fail-open).
- **Negative (evidence reader throws):** Given the injectable throws (corrupt repo), When the
  gate runs, Then the gate treats it as evidence-unavailable per the injectable's contract —
  the error is not swallowed into a false pass (incomplete with reason).

### Done When
- [ ] `CompletionContext` carries a new injectable push-evidence reader; the finish predicate
      consults it for `choice=pr` only.
- [ ] Evidence check is offline (local tracking-ref ancestry), with the remote derived from
      the branch's upstream config, falling back to `origin`.
- [ ] Unit tests cover: pass-with-evidence, stale-URL fail, never-pushed fail, absent
      injectable fail-open — in `test/engine/artifacts.test.ts` alongside the existing finish
      predicate tests.

---

## Story 2 — daemon-mode keep/merge-local do not converge DONE

As the daemon, I never treat "the work stayed local" as a completed feature.

- **Happy (interactive unchanged):** Given a non-daemon interactive run, When the operator
  chooses `keep` or `merge-local` and the fresh marker is written, Then the finish gate
  passes exactly as today.
- **Negative (daemon keep — the #337 fallback):** Given a daemon/auto run where the finish
  session wrote `finish-choice=keep` (the gh-failure fallback), When the completion gate runs
  with daemon mode threaded in the context, Then the gate returns incomplete with a reason
  naming the choice and why it cannot ship, and the normal retry→remediation→HALT routing
  applies (no `DONE`, no shipped marker, worktree kept by the halt path).
- **Negative (daemon merge-local):** Same as above for `merge-local`.
- **Negative (daemon discard):** Given `finish-choice=discard` in daemon mode, When the gate
  runs, Then the behavior is explicit and tested (per ADR: also non-converging — an
  autonomous run has no operator who could have chosen to discard).

### Done When
- [ ] Daemon mode reaches the finish predicate via `CompletionContext` (explicit field, not
      inferred from env).
- [ ] Unit tests cover all four choices in daemon mode + `keep`/`merge-local` passing in
      interactive mode.

---

## Story 3 — daemon ship guard: shipped marker only for a verified PR ship

As the daemon, I write `{"status":"shipped"}` only when the outcome proves a PR ship:
`finishChoice === 'pr'` AND `prUrl` non-null.

- **Happy:** Given an outcome `{done:true, finishChoice:'pr', prUrl:'https://…'}`, When
  `makeRunFeature` handles it, Then `markProcessed(slug, prUrl)` is called, the worktree is
  removed, and the result is `status:'done'` with the prUrl.
- **Negative (the #337 incident):** Given `{done:true, prUrl:undefined}` (any finishChoice),
  When the done-branch runs, Then NO processed marker is written, the worktree is KEPT, a
  HALT marker is written into the worktree's `.pipeline` with a reason naming the
  contradiction ("done without a verified PR ship: choice=<x>, prUrl=null"), **the
  `.pipeline/DONE` marker is deleted** (conflict resolution 2026-07-06: done and halted stay
  disjoint states, so the halt-reconciliation dashboard/re-kick stories hold unchanged), and
  the feature result is `status:'halted'` — so a later daemon pass re-sees the feature as
  halted, not done.
- **Negative (missing choice marker):** Given `{done:true, prUrl:'https://…',
  finishChoice:undefined}` (marker missing/malformed), When the done-branch runs, Then it is
  treated as a failed ship (HALT path), not the pre-Task-12 "default to ship".
- **Negative (label/enroll side effects skipped):** Given the HALT path fires, When it
  completes, Then clear-on-success label removal and mergeable-watch enroll did NOT run for
  the unshipped feature.

### Done When
- [ ] `daemon-runner.ts` done-branch consults `outcome.finishChoice` + `outcome.prUrl` before
      any ship side effect.
- [ ] On halt, `.pipeline/DONE` is removed in the same operation that writes HALT; a test
      asserts the worktree ends with HALT present and DONE absent.
- [ ] Unit tests in `test/engine/daemon-runner.test.ts` (injected `readOutcome`/
      `markProcessed` recorders) cover: verified ship, null-prUrl halt, missing-choice halt,
      and marker-recorder asserting zero `markProcessed` calls on halt.

---

## Story 4 — failed-ship HALT is surfaced, and the work survives every branch

As the operator, a false-ship attempt reaches me as a visible HALT with the work preserved —
even when the surfacing itself degrades.

- **Happy:** Given the ship guard fires, When the HALT path runs, Then `escalateBuildFailure`
  is invoked with the worktree as cwd (so it derives the feature branch), pushes the branch,
  and finds-or-creates the draft `needs-remediation` PR with the failure reason comment.
- **Negative (escalation push fails — FR-7):** Given the escalation's own `git push` fails
  (offline, auth), When the HALT path runs, Then escalation exits early without a PR (its
  documented contract), but the HALT marker is still written, the worktree is still kept, no
  shipped marker exists, and the feature result is still `halted` — surfacing degrades,
  protection does not.
- **Negative (escalation throws are impossible by contract):** Given any internal escalation
  error, When the HALT path runs, Then nothing propagates (escalateBuildFailure never
  throws) and the halt outcome is unchanged.
- **Negative (invariant on the alternate branch):** Given the HALT path fires after
  `emitDaemonSignal` already ran, When the feature completes, Then the daemon's per-feature
  bookkeeping (maybeSweep) still runs exactly as it does for the existing `halted` branch —
  the new branch does not skip the shared post-feature side effects.

### Done When
- [ ] HALT path reuses `escalateBuildFailure` (no new gh entry point) with the worktree cwd.
- [ ] Tests inject a failing-push fake git runner and assert: HALT marker written, worktree
      kept (teardown called with keep=true), no processed marker, result `halted`.

---

## Story 5 — live-ship marker invariant (repair path explicitly exempt)

As the daemon, my live ship path can never record `{"status":"shipped","prUrl":null}`.

- **Happy:** Given a verified ship, When `markProcessed` is called from the done-branch,
  Then the marker carries the non-null prUrl.
- **Negative (call-site guard):** Given any done-outcome without a verified PR ship, When the
  done-branch runs, Then `markProcessed` is not reachable (Story 3) — asserted by the
  marker-recorder test.
- **Negative (repair path stays legitimate):** Given `discoverBacklog` finds a committed
  shipped record on the base branch whose record is malformed, When `repairProcessed` runs,
  Then it still writes `{"status":"shipped","prUrl":null}` — the ship is proven by the merged
  record itself (ADR scope note), and this test documents the exemption so a later "fix"
  doesn't break cache repair.

### Done When
- [ ] A regression test pins the repair-path exemption alongside the live-path guard.

---

## Story 6 — /finish skill STOP gate: verify before recording `pr`

As the finish skill, I do not claim a PR ship I cannot prove.

- **Happy:** Given `/pr` completed, When the skill verifies `gh pr view --json url` returns a
  non-empty URL AND `git merge-base --is-ancestor HEAD refs/remotes/origin/<branch>`
  succeeds, Then it writes `pr_url` to conduct-state and `pr` to `finish-choice`.
- **Negative (push didn't land):** Given the ancestry check fails, When the gate runs, Then
  the skill does NOT write `finish-choice`/`pr_url`, and STOPs stating what failed and what
  to do (mirroring §1b's STOP-gate pattern) — in daemon mode the unwritten marker leaves the
  completion gate unsatisfied (Story 1 backstop).
- **Negative (gh returns empty/error):** Given `gh pr view` fails or returns empty, When the
  gate runs, Then same STOP — the skill must not fall back to writing `pr` with a guessed or
  stale URL, and must not silently write `keep` to mask a pr-path failure it can surface.

### Done When
- [ ] `skills/finish/SKILL.md` §5 Option 2 carries the STOP gate; the auto-mode block (§4)
      references it.
- [ ] `test/test_harness_integrity.sh` passes (frontmatter/section-numbering checks).
