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
| Type check | `cd src/conductor && npm run typecheck` |
| Build the engine | `cd src/conductor && npm run build` |
| Structural integrity of the repo | `bash test/test_harness_integrity.sh` (from the repo root) |

`npm test` expands to:

```bash
vitest run --reporter=dot --silent --slowTestThreshold=1800000 && echo 'AGGREGATE_TEST_SUITE_PASS'
```

The `AGGREGATE_TEST_SUITE_PASS` sentinel is load-bearing: it is the success token the pre-SHIP
`test_suite` gate reads. Do not replace `npm test` with a raw `vitest run` when producing completion
evidence.

> **Known limitation.** No lint script exists — `src/conductor/package.json` has only `build`, `test`,
> `test:watch`, and `typecheck`, and there is no ESLint, Prettier, or shellcheck config anywhere in the
> repo. The one lint hook, `hooks/claude/lint-after-edit.sh`, gates on `*.rb` and shells out to
> `bundle exec standardrb`, so it exits 0 for every file in this TypeScript-and-bash repository.
> `npm run typecheck` is the only static check you get. Tracked in
> [#1028](https://github.com/jstoup111/ai-conductor/issues/1028).

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

> **Known limitation.** `npm run typecheck` never sees the tests.
> `src/conductor/tsconfig.json:17` sets `"exclude": ["node_modules", "dist", "test"]`, so `tsc --noEmit`
> compiles `src/**/*` only. The write-tests skill's completion checklist asserts "Typecheck passes"
> (`.agents/skills/write-tests/SKILL.md:136`) and its authoring loop runs `npm run typecheck` (`:105`);
> neither statement covers the file you just wrote. A type error in a test surfaces only when Vitest
> transpiles and runs it. Tracked in [#1015](https://github.com/jstoup111/ai-conductor/issues/1015).

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

Three files run automatically and exist because each one prevented a real incident.

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

It also sweeps stale tmpdir-rooted daemon sessions before the run and installs a best-effort SIGINT and
SIGTERM reap, because Vitest's global teardown only fires on a normal exit.

### Leak guards

`test/pipeline-leak-guard.ts`, `test/signals-leak-guard.ts`, and `test/tmux-leak-guard.ts` hold the
snapshot and diff logic. The tmux guard is fail-closed by design: killing a session requires both that
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
| `test/smoke/mutation-gate-probe.smoke.test.ts` | Opt-out: runs when the `claude` binary and auth are present unless `MUTATION_GATE_PROBE=0` | `npx vitest run test/smoke/mutation-gate-probe.smoke.test.ts` |
| `test/smoke/finish-record.smoke.test.ts` | None | `npx vitest run test/smoke/finish-record.smoke.test.ts` |
| `test/smoke/publish-interrupted.smoke.test.ts` | None | `npx vitest run test/smoke/publish-interrupted.smoke.test.ts` |
| `test/smoke/surgical-finish-retry.smoke.test.ts` | None | `npx vitest run test/smoke/surgical-finish-retry.smoke.test.ts` |
| `test/execution/claude-provider.smoke.test.ts` | Opt-out: `MODEL_UNAVAILABLE_SMOKE=0`, `AUTH_FAILURE_SMOKE=0` | `npx vitest run test/execution/claude-provider.smoke.test.ts` |
| `test/execution/codex-provider.smoke.test.ts` | Opt-in: `CODEX_CLI_SMOKE_TEST=1` plus the `codex` binary | `CODEX_CLI_SMOKE_TEST=1 npx vitest run test/execution/codex-provider.smoke.test.ts` |
| `test/backlog-priority.smoke.test.ts` | Opt-in: `PRIORITY_GH_SMOKE` set | `PRIORITY_GH_SMOKE=1 npx vitest run test/backlog-priority.smoke.test.ts` |
| `test/engine/build-token-auth.smoke.test.ts` | Opt-out: needs the binary and `CLAUDE_CODE_OAUTH_TOKEN`, unless `BUILD_TOKEN_AUTH_SMOKE=0` | `npx vitest run test/engine/build-token-auth.smoke.test.ts` |

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

`mutation-gate-probe.smoke.test.ts` also carries a second `describe` deliberately placed outside its own
`skipIf`, so every run reports whether the gated suite ran and why not. That block does not touch the
real binary.

## Bash test scripts

33 `.sh` files live under `test/`. Only three ever execute:

- `test/test_harness_integrity.sh`, run by CI and by the self-host release gate. See
  [validation](validation.md).
- `test/test_ci_detect_docs_only.sh` and `test/test_provider_skill_contracts.sh`, executed by the
  integrity suite as checks 13 and 14.

> **Known limitation.** The other 30 scripts — `test_bin_update.sh`, `test_conduct_worktree.sh`, the five
> `test_install_*.sh`, the ten `test_examples_*.sh`, `test_skill_pipeline_contract.sh`,
> `test_release_unreleased_state.sh` and the rest — are only `bash -n` syntax-checked by integrity check
> 1. Nothing executes them, in CI or locally, and no documented command runs them as a suite. A behavioral
> regression in `bin/install`, `bin/update`, or `bin/setup` will not be caught by any automated gate; run
> the relevant script by hand (`bash test/test_bin_update.sh`) when you change those surfaces.
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
2. `integrity` — skipped when `docs_only` is true; runs `bash test/test_harness_integrity.sh`.
3. `typecheck` — `npm ci` then `npm run typecheck` in `src/conductor`.
4. `conductor` — `npm ci`, `npm run build`, `npm test` in `src/conductor`.
5. `ci-gate` — `if: always()`; fails when any of the four is `failure` or `cancelled`. This is the
   required-status aggregator.

Node comes from `src/conductor/.tool-versions` (`nodejs 20.19.2`) and the npm cache keys on
`src/conductor/package-lock.json`.
