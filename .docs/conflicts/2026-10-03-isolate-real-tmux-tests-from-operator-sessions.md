# Conflict Report: Isolate real-tmux tests from operator sessions (#2476)

**Date:** 2026-10-03
**New stories:** `.docs/stories/isolate-real-tmux-tests-from-operator-sessions.md` (Stories 1–6)
**ADR corpus:** `repo_wide` (`conflict_check.adr_corpus`)
**Result:** PASS after resolution. 1 blocking conflict found and resolved; 0 degrading accepted.

## Conflict: Leak-guard visibility of the restart-wiring fixture session

**Stories involved:** Story 1 "Every real tmux session the suite creates is reachable by the leak guard" (#1616) vs Stories 1, 2, 6 (#2476)
**Files:** `.docs/stories/close-the-unguarded-tmux-fixture-session-that-orph.md` vs `.docs/stories/isolate-real-tmux-tests-from-operator-sessions.md`
**Type:** contradiction
**Severity:** blocking

**Description:** The #1616 story required the restart-wiring session to appear in the leak guard's
listing, alongside real repository checkout sessions, which places the fixture on the operator
server. #2476 moves the fixture onto a private fixture server and confines the leak guard to the
run's own server, so the leak guard can never list it. Fully satisfying either story breaks the
other's criterion.

**Resolution Options:**
1. Restate #1616 Story 1 in fixture-server terms; its intent (no stranded fixture session survives an interrupted run) is delivered by #2476 Stories 3 and 4.
2. Extend the leak guard to enumerate every fixture socket root.

**Resolution (operator-selected):** Option 1. #1616 Story 1 rewritten in place: the session is
observed on its own fixture server, the fixture server is stopped after cleanup, and an
interrupted run's fixture server is stopped by the next run's sweep. The leak guard's injected-runner
sweep regression (spare a real-checkout session in the same listing) is retained.

## Examined, no conflict (both directions checked)

| Item | Finding |
|---|---|
| `tmux-leak-guard-fails-open-transient-snapshot-fail.md` | Fail-closed baseline and tmpdir pane-cwd corroboration still apply; only the server inspected changes. |
| `test-spawned-daemons-leak-real-tmux-daemons-persis.md`, #1616 Story 2 | Kill-switch semantics unchanged; injected runners remain unguarded by design, which the fixture runner relies on. |
| `reliable-disk-backed-test-temporary-storage-for-co.md`, `exempt-vitest-temp-dir-from-tmpdir-leak-guard.md`, `sweep-stale-vitest-run-temp-roots-at-global-setup-.md` | Socket roots use the existing run-attributed external prefix and stale policy; owned roots are removed, so the tmpdir guard stays green; daemon-session cleanup is not broadened. |
| `vitest-daemon-fixtures-leak-into-shared-operationa.md` (#2471) | Independent env redirect in `test/setup.ts`; textual merge contact only. |
| `daemon-supervised-hosting.md`, `fix-400-stale-engine-respawn-in-place-stacks-daemo.md`, lifecycle/restart stories | Production tmux behavior unchanged. |

## ADRs

Examined (mention tmux, leak guards, or the kill-switch): adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting,
adr-2026-07-04-respawn-in-place-restart, adr-2026-07-06-stale-engine-respawn-in-place,
adr-2026-07-07-single-generation-stale-respawn, adr-2026-07-04-pending-restart-queue,
adr-2026-07-03-daemon-auto-restart-stale-engine, adr-2026-10-01-daemon-session-command-contracts.
`adr-2026-07-04-respawn-in-place-restart` requires a real-tmux smoke (scrollback survival,
exact-name targeting); #2476 Story 6 retains it on a private server. No conflict.

Narrowed out (no subject overlap with test fixture isolation): adr-2026-06-30-background-intake-brain-loop,
adr-2026-07-04-park-unpark-cli-verbs, adr-014-otel-observability-exporter,
adr-2026-07-01-machine-scoped-operator-identity, adr-2026-07-10-inline-work-attribution-enforcement,
adr-2026-07-22-canonical-tracker-client-seam, adr-2026-07-10-observed-close-watch-registry,
adr-2026-07-20-ci-fix-dispatch-via-steprunner, adr-2026-08-27-daemon-dispatcher-executor-seam,
adr-2026-09-05-gh-cli-version-floor-and-environment-gate, adr-2026-09-20-halt-resolution-queue-derived-from-markers,
adr-005-non-autonomy-and-read-only-governor, adr-2026-09-24-built-in-provider-catalog-and-boot-discovery,
adr-2026-08-09-bash-yaml-access-via-conduct-ts-config.

## Re-check

Re-ran the scan after the rewrite: zero blocking, zero degrading conflicts.
