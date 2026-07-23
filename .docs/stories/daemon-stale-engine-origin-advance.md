**Status:** Accepted

# Stories: daemon-stale-engine-origin-advance

Technical track (no PRD). Source: intake #598; design:
`adr-2026-07-22-origin-refresh-before-engine-rebuild` (APPROVED),
`.docs/architecture/2026-07-22-daemon-stale-engine-origin-advance.md`.
Out of scope: re-kick backoff (#681).

---

## Story: Merged engine fix reaches the running daemon without operator action

**Requirement:** TI-1 (fetch-before-rebuild at the quiescent gate)

As a harness operator, I want the self-host daemon to fast-forward its own checkout before
the quiescent-boundary engine rebuild, so that a fix merged to `origin/main` is loaded and
exercised without me running pull + rebuild + restart.

### Acceptance Criteria

#### Happy Path
- Given a continuous self-host daemon with `auto_restart_on_stale_engine: true`, a clean root
  checkout on the default branch that is N≥1 commits behind `origin/<default>` where the
  behind commits change engine source, when the daemon reaches a quiescent boundary
  (pre-dispatch or drained idle) with no in-flight builds, then the checkout is fast-forwarded
  to `origin/<default>`, the rebuild publishes a new engine version, the stale-engine checker
  reports `stale`, and the existing restart transport fires (marker written, lock released,
  clean exit).
- Given the respawned daemon after that restart, when it captures its engine identity at boot,
  then the loaded engine's stamped source SHA is the fast-forwarded commit (≥ the merge
  commit) and subsequent feature dispatches run on the post-fix engine.
- Given the behind commits touch no engine source (e.g. docs-only), when the quiescent
  refresh + rebuild runs, then publish reports content unchanged, the checker reports
  `current`, and no restart fires (no spurious restart on non-engine merges).

#### Negative Paths
- Given a build is in flight (`inFlight` non-empty), when a quiescent-boundary check is
  evaluated, then no fetch, rebuild, or restart occurs — the refresh chain never runs
  mid-build.
- Given the fetch fails (origin unreachable), when the quiescent refresh runs, then the
  failure is logged, the daemon continues on its current engine, no restart fires, and the
  daemon loop does not crash.
- Given the rebuild fails (`npm run build` non-zero) after a successful fast-forward, when
  the quiescent gate runs, then the error is logged, the daemon degrades to the current
  engine, and no restart fires (fail-closed on indeterminate artifact state).
- Given a non-self-host daemon or `auto_restart_on_stale_engine: false`, when a quiescent
  boundary is reached, then no fetch or rebuild of the daemon's checkout occurs via this
  path (self-heal chain stays self-host-gated).
- Given the restart would not change the engine identity (non-convergence suppression
  active), when the checker reports stale, then the existing suppression prevents a restart
  loop — unchanged by this feature.

### Done When
- [ ] `rebuildAndMaybeRestartForStaleEngine` invokes a new injected `refreshEngineSource`
      dep before `rebuildEngine`, only when `staleGatesArmed` and `inFlight.size === 0`;
      unit tests cover order, quiescence guard, and non-fatal failure.
- [ ] `refreshEngineSource` is wired self-host-only in `src/daemon-cli.ts` (alongside
      `rebuildEngine`) and delegates to the existing `fastForwardRoot` (not a fork).
- [ ] An integration-style test proves: behind-origin engine change → quiescent boundary →
      published new version → checker `stale` → restart requested; and docs-only advance →
      no restart.

---

## Story: Origin fetches are throttled at the quiescent boundary

**Requirement:** TI-2 (fetch throttle)

As a harness operator, I want the pre-dispatch origin refresh rate-limited, so that a busy
backlog does not fetch on every dispatch and hammer the network or slow the loop.

### Acceptance Criteria

#### Happy Path
- Given the refresh ran less than the configured min-interval ago, when another quiescent
  boundary is reached, then the fetch is skipped silently (no warning, no log spam) and the
  rebuild/check proceeds against the current checkout.
- Given the min-interval has elapsed, when a quiescent boundary is reached, then the fetch
  runs again.

#### Negative Paths
- Given no throttle value is configured, when the daemon starts, then a sane default on the
  order of the idle-poll interval applies (never zero / unthrottled).
- Given an invalid configured interval (negative, non-numeric), when config is resolved,
  then the value is rejected/coerced to the default per existing config validation posture —
  the daemon never runs unthrottled by accident.
- Given repeated quiescent boundaries inside one throttle window with the engine genuinely
  behind origin, when the window expires, then the next boundary fetches and the self-heal
  chain proceeds — a throttled skip delays, never permanently suppresses, the refresh.

### Done When
- [ ] Throttle interval is config-derived, read once at startup in `src/daemon-cli.ts`, with
      a documented default; validation rejects invalid values.
- [ ] Unit tests cover: skip inside window, run after expiry, default when unset, invalid
      value handling.
- [ ] The throttled-skip path emits no staleness warning.

---

## Story: Published engine versions carry their source commit SHA

**Requirement:** TI-3 (source-SHA stamp)

As a harness operator, I want each published engine version stamped with the source commit
SHA it was built from, so that "is the loaded engine ≥ the merge commit?" is answerable from
disk.

### Acceptance Criteria

#### Happy Path
- Given a publish that flips `dist` to a new version, when publish completes, then a sidecar
  next to `.engine-source-key` records the source repo's HEAD SHA at build time, and the
  daemon's startup log line (or status surface) can report the loaded engine's source SHA.

#### Negative Paths
- Given the SHA cannot be determined at publish time (e.g. `git rev-parse` fails or not a
  git checkout), when publish runs, then publish still succeeds, the sidecar is omitted or
  marked unknown, and no consumer treats the absence as an error (fail-closed:
  observability only).
- Given a version published before this feature (no sidecar), when the daemon or advisory
  probe reads it, then the SHA is treated as unknown — never a crash, never a restart
  trigger.
- Given a content-unchanged publish (skip path), when publish no-ops, then the existing
  version's sidecar is left as-is (no stamp churn on skipped publishes).

### Done When
- [ ] `publish-engine.mjs` stamps the source SHA sidecar on every publish that finalizes a
      version; tests cover stamp-on-publish, absence-on-failure, and skip-path no-churn.
- [ ] The restart decision path provably does not read the SHA (restart remains
      content-hash keyed).

---

## Story: Staleness is loud on every degraded self-heal path

**Requirement:** TI-4 (loud deduped staleness warnings)

As a harness operator, I want a prominent warning with the exact reload path whenever the
daemon knows it is behind `origin/<default>` but cannot self-heal, so that a stale engine is
never silent.

### Acceptance Criteria

#### Happy Path
- Given a self-host daemon whose root checkout is dirty (fast-forward heal cannot resolve
  it), when the quiescent refresh determines the checkout is behind `origin/<default>`, then
  the daemon log carries a prominent warning naming the cause (`dirty tree`) and the exact
  reload path (`git pull --ff-only origin <default>`; `npm run build` in `src/conductor`;
  `conduct daemon restart`).
- Given the root checkout has diverged from `origin/<default>` (non-fast-forwardable), when
  the quiescent refresh runs, then the same warning fires with cause `diverged`.
- Given a non-self-host daemon or `auto_restart_on_stale_engine: false` where the engine's
  stamped source SHA is determinably behind a fetched `origin/<default>`, when the advisory
  probe runs at the quiescent boundary, then the warning fires with cause `self-heal
  disabled` and the reload path.

#### Negative Paths
- Given the same cause and same behind-SHA already warned, when subsequent quiescent
  boundaries occur, then the warning is not repeated (deduped per cause+SHA) — no log spam
  from a persistent condition.
- Given origin advances again (new SHA) while the degraded condition persists, when the next
  refresh observes the new SHA, then one new warning fires (dedup is per SHA, not forever).
- Given staleness cannot be determined (fetch failed AND no prior knowledge of origin's
  head; or no origin remote), when the boundary runs, then no false-positive stale warning
  fires — unknown is not "stale", and a local-only repo is never nagged.
- Given the checkout is up to date with `origin/<default>`, when the refresh runs, then no
  staleness warning fires.

### Done When
- [ ] Every degraded path (dirty, diverged, fetch failure with known advance, non-self-host,
      flag off) emits exactly one deduped warning containing the cause token and all three
      reload commands; unit tests assert message content, dedup, and re-arm on new SHA.
- [ ] No-origin and indeterminate cases provably emit nothing.

---

## Story: Operators can follow the documented behavior

**Requirement:** TI-6 (docs)

As a harness operator, I want the refresh/throttle/warning behavior documented where the
existing stale-engine docs live, so the runbook matches the machinery.

### Acceptance Criteria

#### Happy Path
- Given the shipped feature, when reading `docs/daemon-operations.md`,
  `docs/configuration.md`, and `src/conductor/README.md`, then they describe the
  fetch-before-rebuild step, the throttle config key + default, the SHA sidecar, and the
  degraded-path warning (with its cause tokens), consistent with the ADR.

#### Negative Paths
- Given the docs build/lint or harness integrity checks, when they run over the updated
  docs, then no stale references remain claiming the rebuild-only trigger is the sole path
  (the pre-#598 wording is corrected, not duplicated).

### Done When
- [ ] All three docs updated in the same PR; CHANGELOG `[Unreleased]` entry present.
- [ ] `docs/configuration.md` documents the new throttle key, default, and validation.

---

**Status:** Accepted
