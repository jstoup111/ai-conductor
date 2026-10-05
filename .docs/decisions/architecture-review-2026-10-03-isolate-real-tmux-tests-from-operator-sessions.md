# Architecture Review: Isolate real-tmux tests from operator sessions
**Date:** 2026-10-03
**Mode:** Lightweight (Medium tier). Sections 2 and 4 only.
**Input:** Explore output (technical track, Approach C, comprehensive scope) and the approved diagram
`.docs/architecture/isolate-real-tmux-tests-from-operator-sessions.md`. Issue #2476.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

**Current exposure (verified, 95%).** Four test files drive real tmux through the production
`defaultTmuxRunner`, which addresses the ambient (operator) tmux server, and each deletes
`AI_CONDUCTOR_NO_REAL_EXEC` to get past the kill-switch: `test/engine/daemon-restart-wiring.test.ts`
(default tier), `test/engine/daemon-tmux.smoke.test.ts` (smoke tier),
`test/engine/daemon-lifecycle.e2e.test.ts` and `test/engine/daemon-stale-respawn.e2e.test.ts` (e2e
tier).

> **Amended 2026-10-03 by #2476:** `daemon-lifecycle.e2e.test.ts` drives a mocked `TmuxRunner` and touches real tmux only through the server-less `tmuxInstalled()` version probe, so three files (restart-wiring, smoke, stale-respawn) drive the operator server; lifecycle needs no migration, and the audit must accept server-less version probes.

Only `test/engine/daemon-exit-witness-tmux.e2e.test.ts` already uses a private `-L` socket
under its own `TMUX_TMPDIR`. `test/tmux-leak-guard.ts` lists and kills `cc-daemon-*` sessions on the
ambient server by design.

**Socket-resolution mechanism (verified by probe, tmux 3.6, 2026-10-03).** With `TMUX` unset and no
`-L`/`-S`, a tmux client created and found its server at `$TMUX_TMPDIR/tmux-«uid»/default`. With
`TMUX` set to another socket, the client ignored `TMUX_TMPDIR` and followed `TMUX`. The run-level
floor therefore must both set `TMUX_TMPDIR` and strip `TMUX` and `TMUX_PANE`, and the static rule
must reject tests that re-introduce either, or pass `-S`.

| Check | Finding |
|---|---|
| Stack compatibility | No new packages. Environment setup, one shared test-support module, one structural test. |
| Prerequisites | None. tmux is already an optional dependency; real-tmux tests keep skipping cleanly when it is absent. |
| Integration surface | Test infrastructure only: the three Vitest configs' load-time setup, `test/setup.ts`, `test/global-setup.ts`, `test/tmux-leak-guard.ts`, five real-tmux test files, and a new structural test. No production module changes. |
| Data implications | None. |
| Performance | One extra tmux server per real-tmux fixture plus one per run; real-tmux tests are already few and serial-safe. Negligible. |
| Worktree isolation | Improves it. Run and fixture socket roots are keyed by the existing run id, so concurrent runs, worktrees and workers never share a server. |

**Socket path length (verified, 90%).** Vitest temporary storage now lives inside the checkout
(#2537), which can exceed the Unix-domain socket path limit (~108 bytes) once tmux appends
`tmux-«uid»/«name»`. The existing `externalFixturePrefix()` in `test/tmpdir-leak-guard.ts` already
solves this for the exit-witness fixture by placing a short, run-attributed `acx-«runid»-…` root in
the real tmpdir. Both the floor root and fixture roots must use it (condition 3).

**Env propagation (verified, 90%).** `vitest.config.ts` installs the run tmp root at config load via
`ensureRunTmpRootSync()`, because Vitest computes its tmpDir before `globalSetup`; forked workers
inherit that env (proven by `tmpdir-redirect-propagation.test.ts`). Installing the floor at the same
point covers `globalSetup` (where the leak guard runs) and every worker and spawned child.

## Alignment

- **Repository rule (CLAUDE.md, Test Process Isolation).** "New or changed real-tmux fixtures MUST use
  a fixture-owned private socket for every command, including discovery and teardown. Never rely on
  session names, the ambient `TMUX` environment, or a production kill-switch." This design delivers
  that machinery and retires the interim "use a mocked adapter until private-socket isolation is
  available" clause, which BUILD should update in the same diff.
- **Design principle: machinery over prompt discipline.** The floor and the structural test replace
  a prose rule with enforcement at the point of violation.
- **Focused local pattern basis.**
  - *Run-scoped environment redirect* — role: isolate a shared resource for the whole test process
    tree. Traits to preserve: installed at config load before Vitest constructs anything; idempotent;
    keyed by the run id; inherited by forked workers and children; removed at teardown and reclaimed
    by the next run's stale sweep. Applies because tmux, like `os.tmpdir()`, reads its location from
    the environment at call time. Rediscovery hints: `ensureRunTmpRootSync`, `sweepStaleRunTmpRoots`
    in `test/tmpdir-leak-guard.ts`; the `AI_CONDUCTOR_ENGINEER_DIR` redirect in `test/setup.ts`.
    Allowed variation: the floor needs a short external root, not the in-checkout run root.
  - *Private-socket fixture* — role: per-fixture tmux server. Traits: every command carries `-L`
    plus an owned `TMUX_TMPDIR`; teardown is `kill-server` on that socket then root removal; the
    runner satisfies the production `TmuxRunner` type so production helpers run unchanged against it.
    Rediscovery hint: `privateTmux` in `test/engine/daemon-exit-witness-tmux.e2e.test.ts`. Allowed
    variation: lifted into shared test support with a registered teardown.
  - *Source-audit structural test* — role: reject a forbidden boundary use across a file tree.
    Traits: a pure audit function over (path, source) returning located findings, a test that
    exercises it on synthetic sources, and a test that runs it over the real tree and expects zero
    findings. Rediscovery hints: `auditGithubInvocationSource` / `findGithubInvocationSites`
    (`src/engine/github-invocation-audit.ts`) and
    `test/engine/github-ownership/24-exhaustive-direct-transport-detection.test.ts`. Allowed
    variation: the audit lives in test support and scans `test/**`, because it governs fixtures, not
    shipped runtime.
- **Production kill-switch unchanged.** `AI_CONDUCTOR_NO_REAL_EXEC` semantics in `daemon-tmux.ts`
  stay as they are. Injected runners are already unguarded by design (see
  `test/acceptance/daemon-supervised-hosting.test.ts`), so migrated tests no longer need to delete the
  marker.
- **Event spine.** No new observation or reporting channel; test failures and existing leak-guard
  messages are the only outputs.
- **Concurrent spec (#2471, `vitest-daemon-fixtures-leak-into-shared-operationa`).** Also edits
  `test/setup.ts` with an independent env redirect. Different concern (OTel, user config); textual
  merge contact only. `/conflict-check` re-examines once stories exist.
- **No ADR created.** No system boundary, decomposition, integration pattern, persistence model or
  platform changes; this is test infrastructure following existing patterns. The §7 structural
  prerequisite is not met.
- **Diagram.** The approved diagram matches this design.

## Wiring Surface

| New surface | Caller (design-time) |
|---|---|
| Run-level tmux floor (sets `TMUX_TMPDIR`, strips `TMUX`/`TMUX_PANE`) | Installed at config load alongside `ensureRunTmpRootSync()` by `vitest.config.ts`, `vitest.e2e.config.ts`, `vitest.smoke.config.ts`, and re-asserted per worker by `test/setup.ts` (loaded by all three via `setupFiles`). |
| Stale floor-root sweep and teardown | Called from `test/global-setup.ts` setup (before the tmux leak-guard baseline) and teardown. |
| Shared private-tmux fixture module | Imported by the five real-tmux test files listed under Feasibility. |
| Test-tree tmux audit + structural test | The structural test runs in the default Vitest tier, so `test_suite` evidence and `test/test_harness_integrity.sh` (which runs the suite) carry it. |

Early overlap scan over these paths (`ai-conductor overlap-scan`, 2026-10-03): no overlap and no
open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A floor root under the in-checkout run root exceeds the socket path limit and every real-tmux call fails | Technical | High if unaddressed | Medium | Condition 3: short external root via `externalFixturePrefix`. |
| A test or child builds its env from scratch and loses `TMUX_TMPDIR`, falling back to the operator default socket | Technical | Low | High | Engine child spawns already scrub `TMUX`/`TMUX_PANE` via `scrubTmuxEnvironment` (#2406). Condition 5 makes the audit flag tmux spawns that pass a fresh env, and the fixture runner always sets its own env explicitly. |
| Leaked sessions that predate this change remain on the operator server, since the leak guard now sees only the run server | Knowledge | Medium | Low | One-time operator cleanup; documented in the validation reference. Nothing new can reach the operator server. |
| Interrupted runs leave orphan tmux servers | Technical | Medium | Low | Condition 4: the next run's sweep runs `kill-server` against each stale root's socket before removing it. |
| Audit false positives on unit tests that mock `spawnSync('tmux', …)` (e.g. `daemon-tmux.test.ts`) | Technical | Medium | Low | Condition 5: an explicit, justified allowlist, kept as narrow as possible. |
| Real-tmux coverage silently becomes skip-only after migration | Technical | Low | Medium | Condition 6. |

## ADRs Created

None.

## Conditions

1. **Two independent layers.** The run-level floor must keep any tmux client in the test process
   tree off the operator server even when a fixture forgets the shared runner, and the fixture
   runner must isolate even if the floor is absent. Each holds without the other.
2. **Production default unchanged.** No production module changes; with the test env absent, tmux
   resolution behaves exactly as today.
3. **Short socket roots.** Floor and fixture `TMUX_TMPDIR` roots are created via the existing
   short, run-attributed external prefix, never under the in-checkout run root.
4. **Owned cleanup only.** Teardown and the stale sweep address a server solely by its own socket
   path under its own root, and never by session name or the ambient default socket. The sweep
   reclaims stale floor and fixture roots left by interrupted runs (`kill-server` then remove).
5. **Static rule scope.** The audit rejects, in `test/**`: tmux invocations outside the shared
   fixture module (and a justified allowlist), assignment or deletion of `TMUX`, `TMUX_PANE` or
   `TMUX_TMPDIR`, explicit `-S` sockets, and tmux spawns given an env that omits the floor. It ships
   with synthetic positive and negative cases plus a whole-tree zero-findings case.
6. **Coverage retained.** The migrated tests keep exercising real restart, respawn-in-place,
   exact-`=` targeting, and cleanup against a real tmux server; they no longer delete
   `AI_CONDUCTOR_NO_REAL_EXEC`.
7. **Docs updated in the same diff.** The CLAUDE.md Test Process Isolation paragraph and
   `docs/contributing/validation.md` describe the shipped mechanism; the interim "use a mocked adapter
   until…" clause is removed.

> **Amended 2026-10-03 by #2476:** Condition 7 is not a BUILD obligation of this plan. The plan skill's documentation boundary forbids documentation tasks, so the CLAUDE.md Test Process Isolation wording and `docs/contributing/validation.md` are updated by a separate documentation delivery after this feature ships. Conditions 1–6 remain binding.

## Blocking Issues

None.
