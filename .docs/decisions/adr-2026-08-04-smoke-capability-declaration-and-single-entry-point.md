# ADR: Smoke files declare a required capability; the tier has one auto-discovering entry point

**Date:** 2026-08-04
**Status:** APPROVED
**Feature:** no-release-time-smoke-or-eval-gate-releases-cut-wi (jstoup111/ai-conductor#1259)
**Related:** adr-2026-08-04-classify-before-spend-release-smoke-gate (the gate that consumes this
runner)

## Context

Running the smoke tier today means knowing nine files and nine different conventions. Verified
2026-08-04, the tier carries **three incompatible gate polarities**:

- **Opt-in** — `AUTORESOLVE_SMOKE_TEST=1`, `CODEX_CLI_SMOKE_TEST=1` (plus a `codex` binary),
  `PRIORITY_GH_SMOKE`. Absent the variable, the file does not run.
- **Kill-switch (opt-out)** — `MODEL_UNAVAILABLE_SMOKE=0`, `AUTH_FAILURE_SMOKE=0`,
  `BUILD_TOKEN_AUTH_SMOKE=0`, `DAEMON_E2E_LIVE_SMOKE=0`. These run *by default* when their
  binary and credential are present.
- **Ungated** — `finish-record`, `publish-interrupted`, `surgical-finish-retry` are plain
  `describe` blocks. Only the Vitest exclusion glob keeps them out of a run;
  `docs/contributing/testing.md` records this as a known limitation.

The issue's hypothesis was to collapse these behind a single opt-in variable. That is the wrong
shape: applying opt-in semantics to the kill-switch files silently disables tests that are
supposed to run whenever credentials exist, converting a real signal into a skip. The variables
also encode the wrong thing — they name a *decision* ("should this run?") when what actually
differs between files is a *fact* ("what does this need?").

The files differ by required capability, and one of them is misfiled by the obvious grouping:
`publish-interrupted.smoke.test.ts` looks ungated and cheap, but it execs `bin/setup`, which runs
`npm install` (`bin/setup:53-54`), with a 600-second timeout. Grouping by "has an env gate" would
have put a network-dependent test in a hermetic tier.

A hard constraint bounds any solution: `test/structural/test-execution-policy.test.ts:79-82`
re-reads `vitest.config.ts` and fails with `vitest.config.ts: default run includes smoke tests`
if either exclusion glob is removed. The default run must keep excluding smoke.

## Decision

**Each smoke file declares the capability it requires, co-located with the test.** A shared helper
replaces the per-file env conditional. The capability is a closed enum:

| Capability | Means | Files |
|---|---|---|
| `hermetic` | No network, no credential, no external binary | `finish-record`, `surgical-finish-retry`, `autoresolve` |
| `toolchain` | Needs a local binary or network install | `publish-interrupted` (npm via `bin/setup`), `backlog-priority` (`gh`), `codex-provider` (`codex`) |
| `credentialed` | Needs a live provider credential | `claude-provider`, `build-token-auth`, `daemon-e2e-live` |

The helper resolves availability once, and the *mode* — not the file — decides what an unmet
capability means:

- **Advisory mode (default, local):** unmet capability → **skip**, recorded with the specific
  capability that was missing. Preserves today's ergonomics: a developer without a `codex` binary
  or an OAuth token still gets a clean run of everything they can run.
- **Gate mode (release):** unmet capability → **failure**. This is what makes the operator's
  outcome real — a release whose smoke tier lacks credentials reports that explicitly instead of
  passing an empty run. It matches the `require_credentials` semantics adr-2026-08-02 already
  defined for the live workflow, so the two halves of the tier fail the same way.

**One entry point, discovery by glob.** `npm run smoke` runs a new `vitest.smoke.config.ts` whose
`include` globs are exactly the default config's `exclude` globs — `test/smoke/**` and
`**/*.smoke.test.ts` — with `exclude: []`. A newly added smoke file is therefore picked up with no
list to edit anywhere, satisfying the requirement that the gate not depend on a maintained
inventory.

`exclude: []` is deliberate and must not be "fixed" into a merge of the default config: Vitest
merges `exclude` arrays additively, so extending the default config would re-exclude every file
this config exists to select. `vitest.live-smoke.config.ts` already documents and relies on this
exact property.

**`vitest.config.ts` is not touched.** The gate is additive — a second config, never a widening of
the default run — so the structural guard keeps passing and `npm test` keeps its isolation
guarantee.

**The run emits a per-file ledger.** Every discovered file is reported as ran / skipped / failed,
naming the unmet capability on a skip and the evidence path on a failure. This is what makes a
blocked release actionable: the failing run itself says which smoke case failed and where to look,
rather than requiring the reader to reconstruct it from Vitest output.

## Alternatives considered

- **One opt-in variable for the whole tier (the issue's hypothesis).** Rejected: it inverts the
  kill-switch files, silently disabling tests meant to run by default when credentials exist.
- **Keep the per-file env vars and add a wrapper script that sets all of them.** Rejected: the
  wrapper becomes the maintained inventory the requirement forbids, and it must encode each file's
  polarity correctly forever.
- **Delete the gates and let files fail when their dependency is absent.** Rejected: makes the
  tier unrunnable locally for anyone lacking every binary and credential.
- **Group by directory (`test/smoke/**` = safe, elsewhere = gated).** Rejected on evidence:
  `publish-interrupted` lives in `test/smoke/` and needs the network, while
  `backlog-priority.smoke.test.ts` lives outside it. Location does not predict capability.

## Consequences

**Positive.** Adding a smoke file requires declaring what it needs and nothing else — no config
edit, no workflow edit, no doc table to update for discovery. The capability enum makes the tier
splittable by cost later (for example, running only `hermetic` somewhere cheap) without revisiting
any individual file. The advisory/gate split means the same command a developer runs locally is
the one the release runs, differing only in strictness.

**Negative.** A one-time migration touches all nine files, and `docs/contributing/testing.md`'s
per-file gate table is replaced by capability documentation. The three files that are currently
ungated will begin running under `npm run smoke`, which may surface pre-existing failures that the
exclusion glob has been hiding — those must be fixed or explicitly quarantined before the gate can
go live, since the gate is fail-closed.
