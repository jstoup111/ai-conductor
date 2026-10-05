# Components and sequences: Real-tmux test isolation from operator sessions

**Last updated:** 2026-10-03
**Scope:** To-be test-infrastructure isolation for jstoup111/ai-conductor#2476. Feature:
`isolate-real-tmux-tests-from-operator-sessions`. Covers the vitest default and e2e tiers'
setup, a run-level tmux socket floor inherited by the whole test process tree, a shared
fixture-owned private-socket runner, the real-tmux tests that migrate onto it, the existing
tmux leak guard, and a static integrity rule. Production `daemon-tmux.ts` behavior and its
`AI_CONDUCTOR_NO_REAL_EXEC` kill-switch are shown only to mark them unchanged.

Verified probe (tmux 3.6, 2026-10-03): with `TMUX` unset and no `-L`/`-S`, the tmux client
resolves its server socket at `$TMUX_TMPDIR/tmux-«uid»/default`; a set `TMUX` variable
overrides `TMUX_TMPDIR`. The floor therefore both sets `TMUX_TMPDIR` and strips `TMUX`/`TMUX_PANE`.

## Component diagram

```mermaid
graph TD
  subgraph SETUP["Vitest setup (default + e2e tiers)"]
    gsetup["global-setup.ts<br/>creates run socket root,<br/>sweeps stale run roots"]
    wsetup["setup.ts (per worker)<br/>sets TMUX_TMPDIR = run/worker root,<br/>strips TMUX and TMUX_PANE"]
  end

  subgraph FIXTURE["Shared test support"]
    runner["Private tmux fixture<br/>fixture-owned -L socket<br/>under its own socket root"]
    teardown["Owned teardown<br/>kill-server on own socket,<br/>remove own socket root"]
  end

  subgraph TESTS["Real-tmux tests (migrated)"]
    t1["daemon-restart-wiring.test.ts"]
    t2["daemon-tmux.smoke.test.ts"]
    t4["daemon-stale-respawn.e2e.test.ts"]
    t5["daemon-exit-witness-tmux.e2e.test.ts"]
  end

  prod["daemon-tmux.ts production runner<br/>(unchanged; inherits floor env)"]
  children["Spawned conduct-ts children<br/>(inherit floor env)"]
  leak["tmux-leak-guard.ts<br/>(inherits floor; only sees run server)"]
  integrity["Static integrity rule<br/>rejects ambient tmux access and<br/>TMUX / TMUX_TMPDIR / -S overrides in tests"]

  runSrv[("Run-private tmux server<br/>under run socket root")]
  fixSrv[("Fixture-private tmux server<br/>one per fixture")]
  opSrv[("Operator tmux server<br/>live daemons")]

  gsetup --> wsetup
  wsetup --> prod
  wsetup --> children
  wsetup --> leak
  prod --> runSrv
  children --> runSrv
  leak --> runSrv
  t1 --> runner
  t2 --> runner
  t4 --> runner
  t5 --> runner
  runner --> fixSrv
  runner --> teardown
  teardown --> fixSrv
  integrity -. "scans" .-> TESTS
  runSrv -. "unreachable" .-x opSrv
  fixSrv -. "unreachable" .-x opSrv
```

## Sequence: fixture lifecycle under the run-level floor

```mermaid
sequenceDiagram
  participant GS as global-setup
  participant WS as setup.ts (worker)
  participant T as Real-tmux test
  participant F as Private tmux fixture
  participant S as Fixture tmux server
  participant Op as Operator tmux server

  GS->>GS: sweep stale run socket roots (kill-server on each, then remove)
  GS->>GS: create run socket root
  WS->>WS: TMUX_TMPDIR = run/worker root, delete TMUX and TMUX_PANE
  T->>F: create fixture
  F->>F: mkdtemp own socket root, unique -L name
  F->>S: every command passes -L «socket» with TMUX_TMPDIR = own root
  T->>F: exercise restart / respawn / cleanup
  F->>S: new-session, respawn-pane, kill-session
  alt success, failure, or thrown error
    T->>F: afterEach teardown
    F->>S: kill-server on own socket
    F->>F: remove own socket root
  end
  Note over GS,Op: Interrupted run: no teardown, but the next run's sweep reclaims the stale root
  Note over T,Op: No path reaches the operator server, even if the kill-switch is deleted or a mock fails
```

## Legend

- **Run-level floor:** the environment set by vitest setup that every tmux client in the test
  process tree inherits, including production `defaultTmuxRunner` calls and spawned children.
- **Fixture-private server:** a per-fixture server addressed only by its own `-L` socket name
  under its own `TMUX_TMPDIR` root; teardown never addresses any other server.
- Dashed `-x` edges mark isolation boundaries: no connection is possible.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-03 | Initial generation | DECIDE for #2476 (Approach C, Medium) |
| 2026-10-03 | Removed `daemon-lifecycle.e2e.test.ts` from migrated tests | It uses a mocked runner; its only real-tmux use is the server-less `tmuxInstalled()` probe |
