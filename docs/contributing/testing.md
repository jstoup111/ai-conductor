---
title: Testing
parent: Contributing
nav_order: 4
---

# Testing

Every test tier in this repo, the command that runs it, and the isolation policy that decides which tier
a new test belongs in. For contributors adding or debugging tests.

Test *authoring* rules — how to pick a seam, bound a conductor fixture, keep time deterministic — live in
[`.agents/skills/write-tests/SKILL.md`](../../.agents/skills/write-tests/SKILL.md), which this repo
mandates for anyone touching tests. This page describes the suite; that skill describes the craft.

## Commands

Run everything from `src/conductor` unless stated otherwise.

| Task | Command |
| --- | --- |
| Install dependencies | `cd src/conductor && npm ci` |
| Full suite (what CI runs) | `cd src/conductor && npm test` |
| One file while authoring | `cd src/conductor && npx vitest run test/<path>.test.ts --reporter=dot --silent` |
| Watch mode | `cd src/conductor && npm run test:watch` |
| Type check (`src/` only) | `cd src/conductor && npm run typecheck` |
| Type check including `test/` | `cd src/conductor && npm run typecheck:test` |
| Lint TypeScript | `cd src/conductor && npm run lint` (`npm run lint:fix` to autofix) |
| Lint shell scripts | `bash test/lint_shell.sh` (from the repo root) |
| Check documentation links | `lychee --config lychee.toml docs README.md AGENT_INSTRUCTIONS.md src/conductor/README.md` |
| Build the engine | `cd src/conductor && npm run build` |
| Structural integrity of the repo | `bash test/test_harness_integrity.sh` (from the repo root) |

`npm test` expands to:

```bash
vitest run --reporter=dot --silent --slowTestThreshold=1800000 && echo 'AGGREGATE_TEST_SUITE_PASS'
```

The `AGGREGATE_TEST_SUITE_PASS` sentinel is load-bearing: it is the success token the pre-SHIP
`test_suite` gate reads. Do not replace `npm test` with a raw `vitest run` when producing completion
evidence.

### The engine-dist guard

Thirteen test files spawn the real `bin/conduct-ts`, which exits 1 when `src/conductor/dist` is
missing or its symlink dangles. `dist` is gitignored, so it does not exist in a fresh clone or
`git worktree` after `npm ci`, and there is no `pretest` hook — nothing built it before the tests
ran. It appeared only partway through a run, whenever some test happened to publish an engine, and
every real-binary test scheduled before that point failed on exit 1.

`test/global-setup.ts` now calls `ensureEngineDist` (`test/engine-dist-guard.ts`) before the first
test: it builds the engine when `dist` does not resolve and is a no-op otherwise, so a warm checkout
pays nothing. When it builds, it prints `engine-dist-guard: built the engine before the run`. You do
not need to run `npm run build` by hand before `npm test`.

This presents as flakiness — a cold worktree fails a handful of real-binary tests, and every re-run
afterwards is green with no code change. If you see that pattern, check whether `dist` resolves
before assuming a race in the code under test.

### Deterministic daemon end-to-end fixture

`test/engine/daemon-e2e-fixture.test.ts` drives a committed fixture from
`test/fixtures/daemon-e2e/` through the real daemon claim, Conductor build,
evidence, completion-gate, and local finish path. A scripted provider fake is
the only external boundary; it makes real local Git commits while the internal
pipeline remains production code. The negative case proves missing task
evidence halts instead of completing.

This test runs in ordinary CI without a separate workflow job.
`vitest.config.ts` includes `test/**/*.test.ts` and excludes only smoke paths
and `*.smoke.test.ts` names, so the existing `conductor` job's `npm test`
invocation runs it and reports through `ci-gate`.

### Live-provider daemon E2E smoke

`test/engine/daemon-e2e-live.smoke.test.ts` is the opt-in real-provider layer
over that deterministic fixture. It dispatches the real Claude provider, then
asserts a successful terminal state (`DONE`, with no `HALT` or park marker), a
new commit, the declared fixture change, and a `Task: 1` trailer. On failure it
uses the deterministic fixture's shared `dumpPipelineDiagnostics` helper to
print the daemon log, halt reason, task status, task evidence, and park markers.

It needs the `claude` binary and the `CLAUDE_CODE_OAUTH_TOKEN` secret; set
`DAEMON_E2E_LIVE_SMOKE=0` to disable an otherwise credentialed local run. Its
token meter defaults `DAEMON_E2E_LIVE_TOKEN_CAP` to `100000`; lower that value
when running the smoke manually. Run it directly from `src/conductor`:

```bash
npx vitest run --config vitest.live-smoke.config.ts test/engine/daemon-e2e-live.smoke.test.ts
```

The reusable [Live daemon E2E workflow](../../.github/workflows/live-daemon-e2e.yml)
is advisory when dispatched normally: a missing credential records a skipped
provider run. A caller can set `require_credentials: true` to make the same
missing-secret condition fail. Claude is the single current matrix entry. To
add a provider, expand that matrix in this workflow, wire its credential into
the job environment, and extend the smoke's provider setup and assertions in
the same change; do not create a parallel live-E2E workflow.

## Linters

Three linters run in CI, each scoped to what `tsc` and `bash -n` cannot tell you.

**Errors only — there is no advisory tier.** Every enabled rule fails the build. Nothing is configured
to `warn`: a rule too noisy to run at `error` is turned off outright and the reason recorded, because a
warning nobody reads only teaches people to ignore the tool. `npm run lint` runs with
`--max-warnings=0`; ShellCheck runs at `--severity=error` and never prints info/style findings. A clean
run prints almost nothing.

| Linter | Config | Scope | Threshold |
| --- | --- | --- | --- |
| ESLint (typescript-eslint, type-aware) | `src/conductor/eslint.config.mjs` | `src/**/*.ts` **and** `test/**/*.ts` | `no-floating-promises`, `await-thenable`, `no-misused-promises` (with `checksVoidReturn.arguments` off) |
| ShellCheck | `test/lint_shell.sh` | `bin/*` (by shebang), `hooks/**/*.sh`, `test/*.sh`, `.github/scripts/*.sh` | `--severity=error` |
| lychee | `lychee.toml` | `docs/`, `README.md`, `AGENT_INSTRUCTIONS.md`, `src/conductor/README.md` | internal links only (offline) |

The ESLint rule set is deliberately tiny. `strict: true` already covers the ground a stock preset
would, so the only rules enabled are ones `tsc` structurally cannot provide: promises created and
then dropped. This is an async daemon on execa/chokidar, where a dropped promise does not throw —
it presents as a silent stall.

No formatter is configured, deliberately: Prettier or Biome across ~85k lines would produce a diff
that buries every real change.

`no-misused-promises` runs with `checksVoidReturn.arguments` disabled. With it on it fires 90 times,
every one of them an async callback passed to a void-return API (`process.on('SIGINT', handler)`,
commander `.action()`), where the only available fix is a `void` wrapper that changes nothing at
runtime. `require-await` is not enabled for the same reason: 40 hits, dominated by `async` functions
that conform to an awaited interface without needing `await` themselves.

ShellCheck's `error` floor is the bar the tree passes today, chosen so the gate enforces from the day
it lands instead of being advisory. Deferred: 91 findings at `warning`, 171 at `info`, 191 at `style`.
Raising it is not mechanical — 45 of the 91 warnings are SC2319 against the deliberate
`assert "desc" "$(cmd; echo $?)"` idiom used throughout the bash suite.

`CHANGELOG.md` is excluded from link checking on purpose: an entry correctly names the document that
existed when it was written, so entries pointing at since-deleted pages are history, not rot.

Tests are linted on the same terms as engine source. ESLint resolves types through
`tsconfig.test.json`, not `tsconfig.json` — the latter excludes `test/`, which would make the project
service fail to resolve every test file and report 599 parse errors instead of linting them.

`no-floating-promises` matters more in a test than in engine code: an unawaited promise in a test does
not fail the test, it leaks async work into whichever test runs next, which is how a suite starts
failing in groups but passing in isolation.

## Test tiers

585 `*.test.ts` files under `src/conductor/test/`. Vitest includes `test/**/*.test.ts` and excludes
`test/smoke/**` and `**/*.smoke.test.ts` (`src/conductor/vitest.config.ts:5-6`), so every tier below
except smoke runs under a bare `npm test`.

| Directory | Files | Covers | Run just this tier |
| --- | --- | --- | --- |
| `test/engine/` | 371 | Mirrors `src/engine/`, including subdirectories for `engineer/`, `engineer/intake/`, `self-host/`, `otel/`, `halt-issues/`, `owner-gate/`. | `npx vitest run test/engine` |
| `test/acceptance/` | 96 | Observable story and gate behavior across the minimum real internal path, with third-party boundaries faked. | `npx vitest run test/acceptance` |
| `test/` (top level) | 41 | Cross-cutting suites not owned by one layer: `wiring-*`, `build-progress-*`, `backlog-priority`, `config-validation`, and tests of the leak guards themselves. | `npx vitest run test/*.test.ts` |
| `test/integration/` | 39 | Real collaboration between internal components; real temp files or local git only where git semantics are the subject. | `npx vitest run test/integration` |
| `test/ui/` | 14 | Renderers, subscribers, dashboard snapshot and text, live region, prompt host. | `npx vitest run test/ui` |
| `test/execution/` | 11 | Provider adapters, the `LLMProvider` contract, token usage, rate-limit parsing, sessions. | `npx vitest run test/execution` |
| `test/smoke/` | 5 | Real binaries and real third parties. Excluded by default. | See [Smoke tests](#smoke-tests). |
| `test/cli/` | 3 | `index.test.ts`, `mode-derivation.test.ts`, `report-flag.test.ts`. | `npx vitest run test/cli` |
| `test/structural/` | 2 | Meta-tests that parse the suite itself. See [Structural meta-tests](#structural-meta-tests). | `npx vitest run test/structural` |
| `test/types/` | 2 | Type-level contracts: `plugin-kind.test.ts`, `test-suite-config-type.test.ts`. | `npx vitest run test/types` |
| `test/fixtures/` | 1 test + helpers | `git-repo.ts` and its test, plus child-process scripts and recorded session-hook payloads. | `npx vitest run test/fixtures` |

Runner shape (`src/conductor/vitest.config.ts`): `pool: 'forks'` with `maxForks: 3` / `minForks: 1`,
`testTimeout: 20000`, `hookTimeout: 30000`, `environment: 'node'`. No reporter is configured in the file
— it comes from the command line.

`npm run typecheck` covers `src/` only — `src/conductor/tsconfig.json` sets
`"exclude": ["node_modules", "dist", "test"]`. `npm run typecheck:test` (`tsconfig.test.json`) covers
`src/` **and** `test/`, and CI runs both. Use it to check the test you just wrote; Vitest transpiles
without type-checking, so it will happily run a test that does not compile.

## Isolation policy

The rule, in one line: a test may reach a third party only if it is an explicitly named smoke test.

| Level | May use | Must fake |
| --- | --- | --- |
| Unit | The function, class, transition, or adapter contract under test. | Every process, network, LLM, GitHub, and filesystem boundary not under test — injected as a mocked adapter. |
| Integration | Real collaboration between internal components; real temp files and local git when git semantics are the subject. | Every third party. |
| Acceptance | The real application entry point, real internal wiring, locally controlled infrastructure. | Every third-party boundary, replaced with a faithful fake through the production adapter seam. |
| Smoke | The real binary or service. | Nothing — that is the point. Must live in `test/smoke/` or be named `*.smoke.test.ts`, and is excluded from the default command and CI. |

"Third party" means LLM providers, hosted APIs, GitHub, email and payment services, webhooks, package
registries, and other network services. The policy text is `HARNESS.md:303-310`, restated at repo level
in `AGENT_INSTRUCTIONS.md:60-64`.

## Global guards

Four files run automatically and exist because each one prevented a real incident.

### vitest.config.ts — the run-scoped `TMPDIR`

The config module calls `ensureRunTmpRootSync(tmpdir())` before Vitest constructs anything. That creates
one `ai-conductor-vitest-run-*` root inside the real tmpdir and points `TMPDIR` at it.

`os.tmpdir()` reads `TMPDIR` on every call, so all ~1,426 `mkdtemp(join(tmpdir(), '<prefix>-'))` call
sites across the suite — including ones written later — land inside that root with no test-file changes,
and `global-setup.ts` deletes the root wholesale at teardown. Before this, the tests that never cleaned
up left tens of thousands of directories in the operator's real `/tmp`; on a tmpfs that exhausted inodes
and broke unrelated production processes with `ENOSPC`.

It is installed in the config rather than in `globalSetup` because Vitest's own project `tmpDir` is
`join(tmpdir(), nanoid())`, evaluated between the two — a redirect any later leaves Vitest's own
random-named SSR cache in the real tmpdir every run. `test/tmpdir-redirect-propagation.test.ts` runs
inside a forked worker and asserts `os.tmpdir()` resolves to the run root, so the env propagation this
all depends on is proven rather than assumed.

None of this excuses a fixture from cleaning up after itself — it bounds the damage when one does not.

### setup.ts

`src/conductor/test/setup.ts` runs before every test file (`setupFiles`) and sets three process-wide
kill-switches:

- `NO_AUTOLAUNCH_ENV=1` — the engineer handoff's default launch path becomes a no-op, so no test spawns a
  real `tmux new-session -d 'conduct-ts daemon --continuous'` that outlives its tmpdir.
- `AI_CONDUCTOR_NO_REAL_EXEC=1` — `makeProductionGh` and `makeProductionGit` refuse to exec. A test once
  added a `needs-remediation` label and a `boom` comment to a live PR; this is the guard against that.
- `AI_CONDUCTOR_ENGINEER_DIR` — redirected to a fresh `mkdtempSync` directory unless a test already set
  it, so nothing writes into the operator's real `~/.ai-conductor/engineer/`.

### global-setup.ts

`src/conductor/test/global-setup.ts` snapshots state before the run and diffs it after:

- `.pipeline` under the test cwd — any added or modified file throws
  `` `.pipeline leak into <cwd> during test run: …` ``.
- Daemon tmux sessions — leaked `cc-daemon-*` sessions are reaped; a killed session fails the run, an
  `indeterminate` one is logged non-fatally.
- The real engineer signals store — a `test-project`-tagged line that leaked into it throws.
- The real tmpdir's top-level entries — anything that appeared during the run and is neither the run root
  nor known concurrent-tooling noise (`self-host-*`, `claude-*`, …) throws `tmpdir-leak-guard: N temp
  entry/entries leaked into the REAL tmpdir …`. That is a temp dir the `TMPDIR` redirect did not
  contain: a hardcoded `/tmp`, an `os.tmpdir()` value cached before the redirect, or a subprocess spawned
  without the inherited env. Fix the call site; widening `IGNORED_TMPDIR_PREFIXES` is only for a genuine
  false positive from a new concurrent tool.

The tmpdir check runs last, so a `.pipeline`, tmux, or signals failure — the more specific diagnosis —
still throws first. The run root is removed in a `finally`, so a failing run still frees the disk.

It also sweeps stale tmpdir-rooted daemon sessions before the run and installs a best-effort SIGINT and
SIGTERM reap, because Vitest's global teardown only fires on a normal exit.

### Leak guards

`test/pipeline-leak-guard.ts`, `test/signals-leak-guard.ts`, `test/tmux-leak-guard.ts`, and
`test/tmpdir-leak-guard.ts` hold the snapshot and diff logic. The tmux guard is fail-closed by design: killing a session requires both that
the baseline snapshot succeeded and that the pane cwd resolves and is tmpdir-rooted. Missing either
signal leaves the session running and logs `tmux-leak-guard: NOT killed (fail-closed): …`.

`test/test-conductor.ts` is the shared Conductor test double. It extends the production `Conductor` with
a passing full-suite verifier so ordinary fixtures do not trip the native aggregate gate.

## Structural meta-tests

`test/structural/` enforces the isolation policy mechanically. Read it before adding a test that touches
a process.

**`test-execution-policy.test.ts`** parses every `.ts` under `test/` with the TypeScript compiler,
excluding itself, `smoke/`, and `*.smoke.test.ts`, and fails on forbidden process calls. It watches
`exec`, `execFile`, `execFileSync`, `execSync`, `spawn`, `spawnSync`, `execa`, and `execaCommand`, and
rejects:

- `claude`, `codex`, `curl`, `wget` as the executable;
- `npm install` or `npm ci`; `npx claude|codex`; `npm exec claude|codex`;
- any `gh` invocation carrying a network subcommand (`api`, `auth`, `cache`, `gist`, `issue`, `label`,
  `pr`, `project`, `release`, `repo`, `run`, `search`, `secret`, `variable`, `workflow`);
- `bin/setup` in any form, including `join('bin', 'setup')`.

The same test re-reads `vitest.config.ts` and reports
`vitest.config.ts: default run includes smoke tests` if either exclusion glob has been removed.

**`fixture-portability.test.ts`** requires `git init -b <branch>` in all four exec shapes unless the call
is `--bare`, commented out, or annotated `// portability-ok: <reason>`. It also flags `.unref()` under
`src/engine/**` and hardcoded absolute `/tmp/...` string literals — use `os.tmpdir()`.

## Smoke tests

Smoke tests are excluded from `npm test` by the two globs in `vitest.config.ts`. Most add a second env
gate on top. There is no `npm run smoke` — run each file directly.

| File | Second gate | Command |
| --- | --- | --- |
| `test/smoke/autoresolve-smoke.test.ts` | Opt-in: `AUTORESOLVE_SMOKE_TEST=1` | `AUTORESOLVE_SMOKE_TEST=1 npx vitest run test/smoke/autoresolve-smoke.test.ts` |
| `test/smoke/finish-record.smoke.test.ts` | None | `npx vitest run test/smoke/finish-record.smoke.test.ts` |
| `test/smoke/publish-interrupted.smoke.test.ts` | None | `npx vitest run test/smoke/publish-interrupted.smoke.test.ts` |
| `test/smoke/surgical-finish-retry.smoke.test.ts` | None | `npx vitest run test/smoke/surgical-finish-retry.smoke.test.ts` |
| `test/execution/claude-provider.smoke.test.ts` | Opt-out: `MODEL_UNAVAILABLE_SMOKE=0`, `AUTH_FAILURE_SMOKE=0` | `npx vitest run test/execution/claude-provider.smoke.test.ts` |
| `test/execution/codex-provider.smoke.test.ts` | Opt-in: `CODEX_CLI_SMOKE_TEST=1` plus the `codex` binary | `CODEX_CLI_SMOKE_TEST=1 npx vitest run test/execution/codex-provider.smoke.test.ts` |
| `test/backlog-priority.smoke.test.ts` | Opt-in: `PRIORITY_GH_SMOKE` set | `PRIORITY_GH_SMOKE=1 npx vitest run test/backlog-priority.smoke.test.ts` |
| `test/engine/build-token-auth.smoke.test.ts` | Opt-out: needs the binary and `CLAUDE_CODE_OAUTH_TOKEN`, unless `BUILD_TOKEN_AUTH_SMOKE=0` | `npx vitest run test/engine/build-token-auth.smoke.test.ts` |
| `test/engine/daemon-e2e-live.smoke.test.ts` | Opt-out: needs the `claude` binary and `CLAUDE_CODE_OAUTH_TOKEN`, unless `DAEMON_E2E_LIVE_SMOKE=0`; cap defaults to `DAEMON_E2E_LIVE_TOKEN_CAP=100000` | `npx vitest run --config vitest.live-smoke.config.ts test/engine/daemon-e2e-live.smoke.test.ts` |
| `test/engine/daemon-tmux.smoke.test.ts` | None; self-skips when `tmux` is not on `PATH` | `npx vitest run test/engine/daemon-tmux.smoke.test.ts` |

> **Known limitation.** Three of the five files in `test/smoke/` — `finish-record`,
> `publish-interrupted`, and `surgical-finish-retry` — are plain `describe` blocks with no env gate at
> all. The Vitest exclusion glob is the only thing keeping them out of a run, so pointing any Vitest
> command at `test/smoke/` explicitly executes them. `publish-interrupted.smoke.test.ts` performs a real
> `git worktree add` against this checkout and then runs the real `bin/setup` inside it, under a 600-second
> timeout; it self-skips only when `bin/setup` is absent. The gating idioms across the nine smoke files
> also disagree — three are opt-in (`AUTORESOLVE_SMOKE_TEST`, `CODEX_CLI_SMOKE_TEST`, `PRIORITY_GH_SMOKE`)
> and three are opt-out kill-switches (`MUTATION_GATE_PROBE`, `MODEL_UNAVAILABLE_SMOKE` /
> `AUTH_FAILURE_SMOKE`, `BUILD_TOKEN_AUTH_SMOKE`), so there is no single rule for whether a smoke file
> runs. Tracked in [#1021](https://github.com/jstoup111/ai-conductor/issues/1021).

## Bash test scripts

40 `.sh` files live under `test/`. Only six ever execute:

- `test/test_harness_integrity.sh`, run by CI and by the self-host release gate. See
  [validation](validation.md).
- `test/test_ci_detect_docs_only.sh` and `test/test_provider_skill_contracts.sh`, executed by the
  integrity suite as checks 13 and 14.
- `test/test_docs_navigation.sh` and `test/test_docs_pages_smoke.sh`, executed by the integrity
  suite as check 17. `test_docs_navigation.sh` in turn shells out to `test/check_docs_navigation.sh`,
  the offline contract checker it validates against fixture and real-tree cases.

`test/docs_pages.smoke.test.sh` is a real, opt-in Pages probe — run it by hand after a default-branch
deployment; it is never invoked from integrity or CI. `test/run_browsable_documentation_site_acceptance.sh`
runs `test_docs_navigation.sh` and `test_docs_pages_smoke.sh` together as the deterministic acceptance
suite for the hosted documentation site story; nothing invokes it automatically.

> **Known limitation.** The rest — `test_bin_update.sh`, `test_conduct_worktree.sh`, the five
> `test_install_*.sh`, the ten `test_examples_*.sh`, `test_skill_pipeline_contract.sh`,
> `test_release_unreleased_state.sh`, `docs_pages.smoke.test.sh`, and
> `run_browsable_documentation_site_acceptance.sh` — are statically checked only: `bash -n` by integrity
> check 1 and ShellCheck by check 1b. Nothing *executes* them, in CI or locally, and no documented
> command runs them as a suite. Static analysis raises the floor but does not make them tests: a
> behavioral regression in `bin/install`, `bin/update`, or `bin/setup` is still caught by no automated
> gate. Run the relevant script by hand (`bash test/test_bin_update.sh`) when you change those surfaces.
> Tracked in [#1021](https://github.com/jstoup111/ai-conductor/issues/1021).

`examples/` holds runnable end-to-end scenarios (`inline.sh`, `interactive.sh`, `daemon.sh`,
`engineer.sh`, `intake-loop.sh`, each taking a tier `s|m|l`). Each creates a throwaway sandbox via
`sandbox_up` and tears it down on exit. They invoke real flows, are not run by CI, and are not a scored
regression suite.

## The aggregate gate

`test_suite` is a real step in the linear sequence, not just a command. The engine reads its contract
from `.ai-conductor/config.yml`:

```yaml
test_suite:
  command: npm test
  working_directory: src/conductor
  timeout_seconds: 1800
```

The `--slowTestThreshold=1800000` in the npm script matches that 1800-second budget, suppressing
slow-test warnings that would otherwise fire on every long run. The ordinary suite is expected to finish
under five minutes; a healthy run is roughly two to three.

For where `test_suite` sits in the flow and what happens when it fails, see
[steps](../reference/steps.md) and [gates](../explanation/gates.md).

## CI

`.github/workflows/ci.yml` runs on pull requests targeting `main`:

1. `changes` — computes `docs_only` by piping `git diff --name-only BASE HEAD` through
   `.github/scripts/ci-detect-docs-only.sh`.
2. `integrity` — skipped when `docs_only` is true; installs `shellcheck`, then runs
   `bash test/test_harness_integrity.sh`.
3. `shellcheck` — skipped when `docs_only` is true; runs `bash test/lint_shell.sh`, the same script
   integrity check 1b calls.
4. `lint` — skipped when `docs_only` is true; `npm ci` then `npm run lint` in `src/conductor`.
5. `typecheck` — `npm ci` then `npm run typecheck` in `src/conductor`.
6. `conductor` — `npm ci`, `npm run build`, `npm test` in `src/conductor`.
7. `links` — **never skipped.** Checks documentation links via `lycheeverse/lychee-action`.
8. `ci-gate` — `if: always()`; fails when any of the above is `failure` or `cancelled`. This is the
   required-status aggregator.

`links` is deliberately the one job with no `docs_only` gate. `docs_only` is true only when every
changed path is under `.docs/` (the internal spec-artifact tree) — see
`.github/scripts/ci-detect-docs-only.sh` — and such a pull request skips every other job here. A link
checker carrying the same gate would inherit that hole. Leaving it ungated also means the guarantee
survives any future widening of the predicate, and it costs about six seconds with no npm install and
no network.

Node comes from `src/conductor/.tool-versions` (`nodejs 20.19.2`) and the npm cache keys on
`src/conductor/package-lock.json`.
