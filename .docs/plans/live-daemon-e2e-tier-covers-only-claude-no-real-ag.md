# Implementation Plan: Live daemon E2E tier covers only Claude — no real-agent Codex signal (#1264)

**Date:** 2026-08-12
**Stem:** live-daemon-e2e-tier-covers-only-claude-no-real-ag
**Track:** technical (no PRD)
**Tier:** M
**Stories:** .docs/stories/live-daemon-e2e-tier-covers-only-claude-no-real-ag.md
**Conflict check:** Clean as of 2026-08-12 — 1 blocking (oscillating) and 1 degrading found and resolved in DECIDE

## Summary

Gives the live daemon E2E tier a real-agent Codex leg by extracting its run body into one
descriptor-parameterized helper, splitting the tier into one smoke file per provider so verdicts
resolve independently, keying gate enforcement to credential presence, and adding a structural
guard that fails when a registered provider has no live leg. 33 tasks.

## Technical Approach

**The seam that decides the shape.** `smoke-runner.ts` parses exactly one
`const smokeCapability` per file, resolves one outcome per file, emits one ledger line per file,
and records failure per file. Capability resolution is file-granular, so provider isolation is a
file-layout property, not a workflow-configuration property. Everything below follows from that.

**Four consumers, one manifest.** A `LIVE_E2E_PROVIDERS` descriptor manifest is the single
enumeration source: it feeds the shared run body, the per-provider smoke files, the per-provider
credential mapping in `smoke-capability.ts`, and the coverage guard. Each descriptor carries the
provider construction, binary name, credential environment variable, self-host executable,
`providerKey`, and — per the conflict-check resolution — the **expected authentication source**,
so the auth assertion is uniform and descriptor-driven rather than a provider name test.

> **Amended 2026-08-17 by #1264:** The manifest is production-owned. Production
> `smoke-capability.ts` must derive its credential mapping from the manifest, and
> `src/conductor/tsconfig.json` excludes the test root from the production `rootDir`, so a
> test-fixture-owned manifest deterministically fails source typecheck (TS6059). The
> `LIVE_E2E_PROVIDERS` enumeration source therefore lives in a production-owned module under
> `src/conductor/src/`; test fixtures may augment its entries with execution-only fields
> (provider construction, run-body wiring) keyed by provider id, and production code never
> imports from the test root. Operator-approved at the 2026-08-17 needs-human halt
> (`stall:manifest-ownership`, remediate-verified 99%).

**Sequencing rationale.** The capability model changes first (tasks 1–8) because both the file
split and the guard depend on per-provider capability members existing. The extraction follows
(9–14) and must be assertion-preserving; the Claude leg is split out before the Codex leg is
added, so a regression in the extraction surfaces against a leg that already works rather than
being confused with new-provider breakage. The Codex leg (15–22) comes third. The coverage guard
(23–28) is last among the code tasks because it asserts against the finished manifest. Workflow
changes (29–31) and the structural-map reconciliation (32–33) close it out.

**Constructor-time auth is a real hazard, not a detail.** `CodexProvider` resolves its
authentication in its constructor (`src/conductor/src/execution/codex-provider.ts:169`). A leg
that constructs before `CODEX_API_KEY` is in `process.env` silently falls back to `cached-login`,
and on a runner with no `~/.codex/auth.json` the failure surfaces as an unrelated file error.
Task 18 exists specifically for this, and the uniform auth-source assertion (task 13) is what
makes the mistake loud.

**Already provider-neutral; do not touch.** `src/conductor/src/engine/self-host/provider-home.ts`
already maps `codex → CODEX_HOME` and strips ambient credentials in `childEnv()`.
`src/conductor/test/fixtures/step-command-preflight.ts` already accepts a `providerKey`. The live
workflow already installs `@openai/codex` (`.github/workflows/live-daemon-e2e.yml:52`). No task
changes any of these.

**Documentation is deliberately absent from this plan.** Per the plan skill's documentation
boundary, no plan task writes or updates project documentation. Architecture-review condition C-5
(`docs/contributing/testing.md` capability documentation and the live-tier operational docs) is
discharged by this repository's `maintain-documentation` custom step, not by a task here.

## Prerequisites

- A `CODEX_API_KEY` repository secret must exist before the Codex leg is gate-enforced. Its
  absence does not block any task in this plan — by design, the leg records a named non-gating
  skip until the secret lands.
- No migration, no schema change, no new dependency.

## Tasks

### Task 1: Provider descriptor type and manifest with the Claude entry
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write a failing test asserting `LIVE_E2E_PROVIDERS` contains a `claude` entry whose fields are
   the provider factory, binary name `claude`, credential variable `CLAUDE_CODE_OAUTH_TOKEN`,
   self-host executable `claude`, provider key `claude`, and expected authentication source, and
   that a descriptor literal missing any required field is rejected by the type checker.
2. Verify test fails (RED).
3. Add the descriptor type and the manifest with the Claude entry only.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): introduce the live provider descriptor manifest"

**Files:**
- `src/conductor/test/fixtures/live-e2e-providers.ts` — new manifest and descriptor type
- `src/conductor/test/fixtures/live-e2e-providers.test.ts` — new test

> **Amended 2026-08-17 by #1264:** Per the manifest-ownership amendment above, the enumeration
> source (descriptor type + manifest entries production consumes) belongs in a production-owned
> module under `src/conductor/src/`; the test-fixture module retains only execution-only
> augmentation keyed by provider id. The original file targets stand as authored history.

**Dependencies:** none

### Task 2: Extend the closed capability union with per-provider credentialed members
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write a failing test asserting `SMOKE_CAPABILITIES` includes `credentialed:claude` and
   `credentialed:codex`, that the union remains closed (an arbitrary string is rejected), and
   that a smoke file declaring an unknown capability is still refused by name.
2. Verify test fails (RED).
3. Add the per-provider members to `SMOKE_CAPABILITIES`.
4. Verify test passes (GREEN).
5. Commit: "feat(smoke): add per-provider credentialed capabilities to the closed union"

**Files:**
- `src/conductor/src/engine/smoke-capability.ts` — capability union
- `src/conductor/test/smoke-capability.test.ts` — test

**Dependencies:** Task 1

### Task 3: Advisory resolution maps each provider to its own credential variable
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write a failing test asserting that in advisory mode `credentialed:claude` resolves against
   `CLAUDE_CODE_OAUTH_TOKEN` and `credentialed:codex` against `CODEX_API_KEY`, each independently.
2. Verify test fails (RED).
3. Replace the hardcoded `CLAUDE_CODE_OAUTH_TOKEN` read in `resolveAdvisorySmokeCapabilities`
   with a per-provider credential lookup derived from the manifest.
4. Verify test passes (GREEN).
5. Commit: "feat(smoke): resolve advisory credentialed capability per provider"

**Files:**
- `src/conductor/src/engine/smoke-capability.ts` — advisory resolution
- `src/conductor/test/smoke-capability.test.ts` — test

**Dependencies:** Task 2

### Task 4: Gate resolution maps each provider to its own credential variable
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write a failing test asserting that in gate mode each per-provider credentialed capability
   resolves against its own variable, and that a present Claude credential with an absent Codex
   credential produces two different outcomes rather than one shared outcome.
2. Verify test fails (RED).
3. Replace the hardcoded read in `resolveGateSmokeCapabilities` with the same per-provider lookup.
4. Verify test passes (GREEN).
5. Commit: "feat(smoke): resolve gate-mode credentialed capability per provider"

**Files:**
- `src/conductor/src/engine/smoke-capability.ts` — gate resolution
- `src/conductor/test/smoke-capability.test.ts` — test

**Dependencies:** Task 3

### Task 5: A credential-absent leg is a named non-gating skip, not a gate failure
**Story:** Story 7
**Type:** happy-path

**Steps:**
1. Write a failing test asserting that in gate mode a leg whose credential is absent produces a
   skip outcome naming the provider and the specific unmet credential variable, and does not
   contribute a failure.
2. Verify test fails (RED).
3. Add the non-gating skip resolution for a credential-absent provider leg in gate mode.
4. Verify test passes (GREEN).
5. Commit: "feat(smoke): record a credential-absent provider leg as a named non-gating skip"

**Files:**
- `src/conductor/src/engine/smoke-capability.ts` — gate resolution
- `src/conductor/test/smoke-capability.test.ts` — test

**Dependencies:** Task 4

### Task 6: A credential-present leg is gate-enforced
**Story:** Story 7
**Type:** happy-path

**Steps:**
1. Write a failing test asserting that in gate mode a leg whose credential is present is enforced
   — its unmet toolchain or its failure fails the run — and that adding the credential alone
   flips a previously-skipped leg to enforced with no other change.
2. Verify test fails (RED).
3. Implement credential-presence-keyed enforcement.
4. Verify test passes (GREEN).
5. Commit: "feat(smoke): gate-enforce a provider leg exactly when its credential is present"

**Files:**
- `src/conductor/src/engine/smoke-capability.ts` — gate resolution
- `src/conductor/test/smoke-capability.test.ts` — test

**Dependencies:** Task 5

### Task 7: The aggregate credentialed-execution check runs after every per-leg resolution
**Story:** Story 7
**Type:** negative-path

**Steps:**
1. Write a failing test asserting that a gate-mode run in which every leg was skipped for an
   absent credential fails, that a run with at least one executed credentialed leg passes the
   aggregate, and that the aggregate is evaluated after the per-file loop rather than during it.
2. Verify test fails (RED).
3. Adjust `assertGateCredentialedExecution` and its call site so per-leg tolerance and the
   aggregate requirement are ordered rather than competing.
4. Verify test passes (GREEN).
5. Commit: "fix(smoke): order per-leg tolerance before the aggregate credentialed check"

**Files:**
- `src/conductor/src/engine/smoke-capability.ts` — aggregate assertion
- `src/conductor/src/engine/smoke-runner.ts` — call ordering
- `src/conductor/test/smoke-capability.test.ts` — test

**Dependencies:** Task 6

### Task 8: An operator force-skip of a credentialed leg still fails in gate mode
**Story:** Story 7
**Type:** negative-path

**Steps:**
1. Write a test asserting that `SMOKE_FORCE_SKIP` naming a credentialed provider leg or its
   capability produces a failure in gate mode, never a non-gating skip — so an override cannot
   quietly de-gate an enforced leg.
2. Verify the existing force-skip behavior already satisfies this for the per-provider members.
3. Commit with an evidence trailer recording that existing behavior satisfies the criterion.

**Files:**
- `src/conductor/test/smoke-capability.test.ts` — test

**Verify-only:** yes
**Dependencies:** Task 7

### Task 9: Extract the shared, descriptor-parameterized live run body
**Story:** Story 2
**Type:** refactor

**Steps:**
1. Write a failing test asserting the shared body, given a descriptor, performs the seed →
   provision → preflight → meter → `runDaemon` → assert sequence, and that it reads its
   executable, provider key, binary name, and credential variable from the descriptor.
2. Verify test fails (RED).
3. Extract the run body from `daemon-e2e-live.smoke.test.ts` into a shared helper parameterized
   by a descriptor, changing no assertion.
4. Verify test passes (GREEN), and confirm the file's existing ungated self-check cases pass
   unchanged.
5. Commit: "refactor(live-e2e): extract the live run body behind a provider descriptor"

**Files:**
- `src/conductor/test/fixtures/live-e2e-run-body.ts` — new shared body
- `src/conductor/test/engine/daemon-e2e-live.smoke.test.ts` — body removed

**Dependencies:** Task 1

### Task 10: The extraction preserves every Claude assertion
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write a failing test asserting the Claude leg still requires all four outcome keys, the
   metering floor, the token cap, and the unmetered-step allow-list — and that none of them is
   weakened, removed, or made conditional by the extraction.
2. Verify test fails (RED).
3. Reconcile any assertion the extraction dropped or relaxed.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): prove the extraction weakened no Claude assertion"

**Files:**
- `src/conductor/test/acceptance/daemon-e2e-live-agent-tier.acceptance.test.ts` — assertions
- `src/conductor/test/fixtures/live-e2e-run-body.ts` — reconciliation

**Dependencies:** Task 9

### Task 11: Split the Claude leg into its own smoke file
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write a failing test asserting a Claude live smoke file exists declaring
   `credentialed:claude` and supplying only the Claude descriptor.
2. Verify test fails (RED).
3. Create the Claude leg file calling the shared body with the Claude descriptor; remove the
   Claude-specific run from the original file.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): give the Claude leg its own capability-declaring smoke file"

**Files:**
- `src/conductor/test/engine/daemon-e2e-live-claude.smoke.test.ts` — new leg
- `src/conductor/test/engine/daemon-e2e-live.smoke.test.ts` — Claude run removed

**Dependencies:** Task 10

### Task 12: A structural check rejects a provider-specific branch inside the shared body
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write a failing test asserting that a provider name test inside the shared body — a comparison
   against a literal provider id — fails the structural check by name.
2. Verify test fails (RED).
3. Add the structural check over the shared body module.
4. Verify test passes (GREEN).
5. Commit: "test(structural): forbid provider-specific branches in the shared live body"

**Files:**
- `src/conductor/test/structural/live-e2e-shared-body.test.ts` — new structural check

**Dependencies:** Task 11

### Task 13: The shared body asserts each leg's authentication source from its descriptor
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write a failing test asserting the shared body compares the provider's resolved authentication
   source against the descriptor's expected value, that the assertion is written once and applies
   to every leg, and that a mismatch fails naming both the expected and the resolved source.
2. Verify test fails (RED).
3. Add the uniform descriptor-driven auth-source assertion to the shared body.
4. Verify test passes (GREEN).
5. Commit: "feat(live-e2e): assert each leg's auth source from its descriptor"

**Files:**
- `src/conductor/test/fixtures/live-e2e-run-body.ts` — assertion
- `src/conductor/test/fixtures/live-e2e-run-body.test.ts` — test

**Dependencies:** Task 12

### Task 14: A leg supplies only a descriptor and no assertion logic of its own
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write a failing test asserting each provider leg's source contains no seed, provision,
   preflight, meter, `runDaemon`, or assert logic — only a descriptor and a call to the shared
   body.
2. Verify test fails (RED).
3. Move any residual leg-local logic into the shared body or the descriptor.
4. Verify test passes (GREEN).
5. Commit: "test(structural): keep provider legs to a descriptor and a call"

**Files:**
- `src/conductor/test/structural/live-e2e-shared-body.test.ts` — leg-shape check
- `src/conductor/test/engine/daemon-e2e-live-claude.smoke.test.ts` — residual logic moved

**Dependencies:** Task 13

### Task 15: The live provider home routes through the real provider's auth preparation
**Story:** Story 1
**Type:** refactor

**Steps:**
1. Write a failing test asserting `provisionLiveProviderHome` takes the descriptor's provider and
   calls that provider's own `prepareSelfHostAuth`, rather than a hand-built provider object with
   an inlined credential closure.
2. Verify test fails (RED).
3. Parameterize the fixture on the descriptor's provider.
4. Verify test passes (GREEN).
5. Commit: "refactor(live-e2e): provision the home from the real provider's auth preparation"

**Files:**
- `src/conductor/test/fixtures/live-provider-home.ts` — parameterization
- `src/conductor/test/fixtures/live-provider-home.test.ts` — test

**Dependencies:** Task 14

### Task 16: Add the Codex descriptor entry
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write a failing test asserting the manifest carries a `codex` entry with binary `codex`,
   credential variable `CODEX_API_KEY`, the Codex self-host executable, provider key `codex`, and
   expected authentication source `api-key`.
2. Verify test fails (RED).
3. Add the Codex entry to `LIVE_E2E_PROVIDERS`.
4. Verify test passes (GREEN).
5. Commit: "feat(live-e2e): declare the Codex live provider descriptor"

**Files:**
- `src/conductor/test/fixtures/live-e2e-providers.ts` — Codex entry
- `src/conductor/test/fixtures/live-e2e-providers.test.ts` — test

**Dependencies:** Task 15

### Task 17: Add the Codex leg smoke file
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write a failing test asserting a Codex live smoke file exists declaring `credentialed:codex`,
   supplying only the Codex descriptor, and driving the same committed `daemon-e2e` fixture with
   the Codex command rendering.
2. Verify test fails (RED).
3. Create the Codex leg file calling the shared body with the Codex descriptor.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): add the Codex leg over the shared run body"

**Files:**
- `src/conductor/test/engine/daemon-e2e-live-codex.smoke.test.ts` — new leg

**Dependencies:** Task 16

### Task 18: The Codex leg sets its credential before constructing the provider
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write a failing test asserting that when `CODEX_API_KEY` is present the leg's provider
   resolves `api-key`, and that constructing the provider before the key is in `process.env`
   resolves `cached-login` and fails the descriptor auth-source assertion by name.
2. Verify test fails (RED).
3. Order the leg so the credential is in `process.env` before the provider is constructed.
4. Verify test passes (GREEN).
5. Commit: "fix(live-e2e): set the Codex credential before constructing the provider"

**Files:**
- `src/conductor/test/engine/daemon-e2e-live-codex.smoke.test.ts` — ordering
- `src/conductor/test/fixtures/live-e2e-run-body.test.ts` — test

**Dependencies:** Task 17

### Task 19: A Codex run with no credential and no cached login fails before any dispatch
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write a failing test asserting that with no API key and no cached login file the leg fails
   naming the missing credential and the path searched, with a dispatch count of zero.
2. Verify test fails (RED).
3. Implement the pre-dispatch credential check for the leg.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): fail a credential-less Codex leg before it spends"

**Files:**
- `src/conductor/test/fixtures/live-e2e-run-body.ts` — pre-dispatch check
- `src/conductor/test/fixtures/live-e2e-run-body.test.ts` — test

**Dependencies:** Task 18

### Task 20: An absent Codex binary reports an unmet toolchain requirement without provisioning
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write a failing test asserting that when the `codex` binary is absent the leg reports an unmet
   toolchain requirement naming `codex` and provisions no home.
2. Verify test fails (RED).
3. Add the binary availability check ahead of provisioning, derived from the descriptor's binary
   name.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): skip before provisioning when a provider binary is absent"

**Files:**
- `src/conductor/test/fixtures/live-e2e-run-body.ts` — availability check
- `src/conductor/test/fixtures/live-e2e-run-body.test.ts` — test

**Dependencies:** Task 19

### Task 21: An unready Codex readiness probe fails before any paid dispatch
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write a failing test asserting that an unready or probe-failed readiness result stops the leg
   before dispatch, and that the failure carries the readiness state and its remediation text
   rather than a bare non-zero exit.
2. Verify test fails (RED).
3. Wire the readiness check into the shared body ahead of dispatch.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): stop an unready provider before it spends"

**Files:**
- `src/conductor/test/fixtures/live-e2e-run-body.ts` — readiness gate
- `src/conductor/test/fixtures/live-e2e-run-body.test.ts` — test

**Dependencies:** Task 20

### Task 22: The Codex home is torn down on both branches and the checkout is unchanged
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write a failing test asserting the provisioned home no longer exists after both a successful
   and a failed Codex run, and that the checkout under test is byte-for-byte unchanged.
2. Verify test fails (RED).
3. Ensure teardown runs on both branches in the shared body.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): tear down the provider home on success and failure alike"

**Files:**
- `src/conductor/test/fixtures/live-e2e-run-body.ts` — teardown
- `src/conductor/test/fixtures/live-e2e-run-body.test.ts` — test

**Dependencies:** Task 21

### Task 23: The cap bounds every leg and each reports its observed total
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write a failing test asserting each leg is bounded by the same cap mechanism and default, that
   the documented override applies to every leg, and that a successful run reports its observed
   total, dispatch count, and the cap in force.
2. Verify test fails (RED).
3. Move the cap and reporting into the shared body so both legs inherit them.
4. Verify test passes (GREEN).
5. Commit: "feat(live-e2e): bound and report every provider leg's spend identically"

**Files:**
- `src/conductor/test/fixtures/live-e2e-run-body.ts` — cap and reporting
- `src/conductor/test/fixtures/live-e2e-run-body.test.ts` — test

**Dependencies:** Task 22

### Task 24: An over-cap total fails on both the success and the failure branch
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write a failing test asserting an over-cap total fails naming the cap, the observed total, and
   the unmetered count — and that the cap assertion runs even when the leg already failed for
   another reason.
2. Verify test fails (RED).
3. Place the cap assertion so it runs on both branches.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): enforce the token cap on the failure branch too"

**Files:**
- `src/conductor/test/fixtures/live-e2e-run-body.ts` — cap placement
- `src/conductor/test/fixtures/live-e2e-run-body.test.ts` — test

**Dependencies:** Task 23

### Task 25: Unmetered and unattributable dispatches fail for every provider
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write a failing test asserting an unmetered dispatch before the publication boundary fails
   naming the step, that an unattributable unmetered dispatch fails regardless of the allow-list,
   and that a provider-shaped usage value the meter does not recognize is reported as unmetered
   rather than silently discarded.
2. Verify test fails (RED).
3. Apply the metering assertions uniformly in the shared body.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): hold every provider to the same metering floor"

**Files:**
- `src/conductor/test/fixtures/live-e2e-run-body.ts` — metering assertions
- `src/conductor/test/fixtures/live-e2e-run-body.test.ts` — test

**Dependencies:** Task 24

### Task 26: A Codex failure dumps diagnostics through the shared path
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write a failing test asserting a Codex failure dumps the daemon log excerpt and the pipeline
   state through the same provider-agnostic diagnostics path the Claude leg uses, with the
   provider's own readiness diagnostic alongside it.
2. Verify test fails (RED).
3. Wire the shared diagnostics dump into the shared body's failure branch.
4. Verify test passes (GREEN).
5. Commit: "feat(live-e2e): dump the same diagnostics for every provider leg"

**Files:**
- `src/conductor/test/fixtures/live-e2e-run-body.ts` — diagnostics
- `src/conductor/test/fixtures/live-e2e-run-body.test.ts` — test

**Dependencies:** Task 25

### Task 27: Diagnostics report an absent worktree or empty log instead of throwing
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write a failing test asserting that a failure before the worktree exists, and a failure with a
   missing or empty daemon log, each report the absence explicitly and still print whatever
   pipeline state exists — never a secondary error hiding the original failure.
2. Verify test fails (RED).
3. Harden the dump against both cases.
4. Verify test passes (GREEN).
5. Commit: "fix(live-e2e): keep diagnostics from masking the original failure"

**Files:**
- `src/conductor/test/fixtures/live-e2e-run-body.ts` — dump hardening
- `src/conductor/test/fixtures/live-e2e-run-body.test.ts` — test

**Dependencies:** Task 26

### Task 28: No credential value reaches a log, diagnostic, or summary
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write a failing test asserting that with credential-shaped text present in a failure message,
   no credential value appears in any emitted log line, diagnostic, or step summary — presence or
   absence only.
2. Verify test fails (RED).
3. Add the redaction or presence-only reporting required to satisfy it.
4. Verify test passes (GREEN).
5. Commit: "fix(live-e2e): report credential presence, never credential value"

**Files:**
- `src/conductor/test/fixtures/live-e2e-run-body.ts` — reporting
- `src/conductor/test/fixtures/live-e2e-run-body.test.ts` — test

**Dependencies:** Task 27

### Task 29: One leg's outcome is unaffected by the other's credential or failure
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write a failing test asserting isolation in both directions — Claude present with Codex
   absent, and Codex present with Claude absent — and that one leg failing outright still leaves
   the other leg's own ledger line emitted and correct.
2. Verify test fails (RED).
3. Reconcile any coupling the test exposes.
4. Verify test passes (GREEN).
5. Commit: "test(smoke): prove per-provider verdict isolation in both directions"

**Files:**
- `src/conductor/test/structural/smoke-entry-point.test.ts` — isolation cases

**Dependencies:** Task 28

### Task 30: Concurrent legs never see each other's home or credential
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write a failing test asserting each leg's child environment carries only its own provider's
   home variable and credential, with the other provider's home variable and credential absent.
2. Verify test fails (RED).
3. Reconcile any leakage the test exposes.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): keep concurrent provider legs environmentally disjoint"

**Files:**
- `src/conductor/test/fixtures/live-provider-home.test.ts` — environment cases

**Dependencies:** Task 29

### Task 31: The coverage guard passes when every registered provider has a leg
**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Write a failing test asserting a structural guard enumerates registered `llm_provider` ids
   from the production registry, asserts each has a live leg and a capability entry, and performs
   no dispatch, requires no credential, and requires no binary.
2. Verify test fails (RED).
3. Add the guard.
4. Verify test passes (GREEN).
5. Commit: "test(structural): require a live leg for every registered provider"

**Files:**
- `src/conductor/test/structural/live-provider-coverage.test.ts` — new guard

**Dependencies:** Task 30

### Task 32: The coverage guard fails for the right reasons and passes without credentials
**Story:** Story 6
**Type:** negative-path

**Steps:**
1. Write a failing test asserting the guard fails naming the provider when a registered provider
   has no leg, fails naming the missing capability entry when a leg has no capability, reports a
   leg left behind for a provider no longer registered, and **passes** when a credential is
   absent.
2. Verify test fails (RED).
3. Implement the failing directions and the credential-independence.
4. Verify test passes (GREEN).
5. Commit: "test(structural): exercise the coverage guard's failing directions"

**Files:**
- `src/conductor/test/structural/live-provider-coverage.test.ts` — failing directions

**Dependencies:** Task 31

### Task 33: Reconcile the structural capability map with the descriptor manifest
**Story:** Story 6
**Type:** refactor

**Steps:**
1. Write a failing test asserting the hardcoded capability map in
   `smoke-entry-point.test.ts` and the descriptor manifest cannot disagree — a provider present
   in one and absent from the other fails naming the disagreement.
2. Verify test fails (RED).
3. Derive the map's provider entries from the manifest.
4. Verify test passes (GREEN).
5. Commit: "refactor(structural): derive smoke capability entries from the provider manifest"

**Files:**
- `src/conductor/test/structural/smoke-entry-point.test.ts` — derivation
- `src/conductor/test/structural/live-provider-coverage.test.ts` — agreement assertion

**Dependencies:** Task 32

### Task 34: The workflow matrix checks and reports each leg independently
**Story:** Story 7
**Type:** infrastructure

**Steps:**
1. Write a failing structural test asserting the live workflow's matrix is load-bearing: each leg
   checks only its own credential variable, selects only its own provider's smoke file, and emits
   a step summary naming the provider and its gating state with the reason for a non-gating skip.
2. Verify test fails (RED).
3. Rewrite `live-daemon-e2e.yml`'s matrix, credential check, smoke selection, and step summary
   per leg, adding `codex` to the matrix.
4. Verify test passes (GREEN).
5. Commit: "ci(live-e2e): make the provider matrix load-bearing per leg"

**Files:**
- `.github/workflows/live-daemon-e2e.yml` — matrix, checks, selection, summary
- `src/conductor/test/structural/release-workflow.test.ts` — workflow assertions

**Dependencies:** Task 33

## Task Dependency Graph

```
Task 1 (descriptor manifest)
 ├─ Task 2 → 3 → 4 → 5 → 6 → 7 → 8        (capability model and gate semantics)
 └─ Task 9 → 10 → 11 → 12 → 13 → 14       (extraction and the shared body's contract)
                              └─ Task 15 → 16 → 17 → 18 → 19 → 20 → 21 → 22   (Codex leg)
                                                                        └─ Task 23 → 24 → 25   (cost)
                                                                                        └─ Task 26 → 27 → 28   (diagnostics)
                                                                                                        └─ Task 29 → 30   (isolation)
                                                                                                                    └─ Task 31 → 32 → 33   (coverage guard)
                                                                                                                                    └─ Task 34   (workflow)
```

Task 2's chain and Task 9's chain are independent of each other and both descend from Task 1;
Task 15 requires Task 14's shared-body contract, and Task 29 requires both chains complete
(Task 8's gate semantics and Task 28's shared body), which the linear ordering above satisfies.

## Integration Points

- **After Task 11:** the Claude leg runs end-to-end from its own capability-declaring file over
  the shared body — the extraction is provable against a leg that already worked.
- **After Task 17:** both legs exist and the tier can be dispatched manually for the first real
  Codex observation (architecture-review condition C-1).
- **After Task 22:** the Codex leg is complete enough for a real `workflow_dispatch` run.
- **After Task 33:** the coverage property holds for any future provider.
- **After Task 34:** the release gate reports both legs independently.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] No terminal catch-all validation task
- [ ] No documentation task (documentation boundary; C-5 is discharged by the
      `maintain-documentation` step)
### Task rem-tautology-1: src/conductor/test/structural/live-e2e-shared-body.test.ts:92-122 — replace test-local-helper and vacuous assertions with extraction-preserving checks against the production shared run body and real leg files that fail when descriptor-only legs, descriptor-driven authentication, or shared diagnostics are removed
### Task rem-tautology-2: src/conductor/test/structural/live-provider-coverage.test.ts:89-125 — assert production registry, LIVE_E2E_PROVIDERS manifest, capability declarations, and real smoke-leg agreement directly from shipped definitions so missing, orphaned, and divergent mappings fail against the merge-base implementation
### Task rem-tautology-3: src/conductor/test/smoke-capability.test.ts:172-232 — exercise credentialed-provider resolution without the pre-diff file-force-skip short circuit and replace the arbitrary-string formatter assertion with production closed-capability and manifest-derived credential assertions
### Task rem-scope-1: src/conductor/src/engine/self-host/provider-home.ts:119 — remove this feature's CODEX_API_KEY stripping hunk and keep provider-specific credential isolation in the live-E2E descriptor/provisioning path without otherwise changing this do-not-touch module
### Task rem-root-cause-1: src/conductor/test/fixtures/live-e2e-run-body.ts:130-136,374-377 and src/conductor/test/fixtures/live-provider-home.ts:17-19 — pass the selected LiveE2EProviderDescriptor through provisioning and invoke that descriptor provider's real prepareSelfHostAuth instead of resolving string calls through DEFAULT_LIVE_PROVIDER
### Task rem-root-cause-2: src/conductor/test/fixtures/live-provider-home.test.ts:1 — prove descriptor-selected Claude and Codex legs invoke their respective real prepareSelfHostAuth paths, create the matching provider home, and inject the resulting ProvisionedHome into both provider invoke methods
### Task rem-completeness-1: src/conductor/src/engine/smoke-capability.ts:44-58 — remove LIVE_SMOKE_PROVIDER_DESCRIPTORS and derive advisory and gate credential-variable lookup from the single LIVE_E2E_PROVIDERS manifest while preserving the closed SmokeCapability union
### Task rem-completeness-2: src/conductor/test/smoke-capability.test.ts:1 — add an @ts-expect-error or equivalent compile-time assertion that an arbitrary string is rejected as SmokeCapability while credentialed:claude and credentialed:codex remain accepted and resolve through manifest-owned credentials
### Task rem-completeness-3: src/conductor/test/fixtures/live-e2e-run-body.test.ts:1 — restore production-path equivalents of the five deleted ungated self-checks: transparent TokenMeter optional-member wrapping, ProvisionedHome injection into both invoke methods, failed preflight before dispatch, post-preflight outcome failure distinct from diagnostics, and pre-halted fixture non-dispatch
### Task rem-completeness-4: src/conductor/test/fixtures/live-e2e-run-body.ts:321-443 — move binary and credential failures plus post-run failures under one shared diagnostic boundary, retain worktree and log evidence until capture completes, handle absent worktrees and missing logs, then tear down in an outer finally
### Task rem-completeness-5: src/conductor/test/fixtures/live-e2e-run-body.ts:328-330 and src/conductor/test/fixtures/live-e2e-run-body.test.ts:1 — sanitize credential-shaped text from diagnostics and the rethrown error, and exercise the actual shared failure path for surviving logs, pre-worktree absence, empty logs, and credential redaction
### Task rem-completeness-6: .github/workflows/live-daemon-e2e.yml:25-43 and src/conductor/test/structural/release-workflow.test.ts:1 — make an absent per-matrix credential, including CODEX_API_KEY, report a provider-named non-gating skip without failing the workflow while credential-present legs remain gate-enforced, and prove both paths structurally
### Task rem-wiring-1: src/conductor/scripts/smoke.ts:1-3 and src/conductor/src/engine/smoke-runner.ts:219 — add a production CLI selection input for one matrix smoke file while retaining discovery, closed-capability validation, gate resolution, ledger emission, and executed-credential enforcement
### Task rem-wiring-2: .github/workflows/live-daemon-e2e.yml:70-74 — replace the direct npx vitest invocation with the configured npm smoke CLI in gate mode, passing only matrix.smoke_file and exporting only matrix.credential_env for that provider leg
### Task rem-wiring-3: src/conductor/test/structural/release-workflow.test.ts:1 — add a production-sensitive assertion proving every workflow matrix leg invokes the smoke CLI and reaches capability resolution with its selected smoke file and credential instead of bypassing the runner with direct Vitest
### Task rem-completeness-credentialed-1: .github/workflows/live-daemon-e2e.yml:16-71, src/conductor/src/engine/smoke-runner.ts:116-123, src/conductor/test/engine/smoke-runner.test.ts:83-145, and src/conductor/test/structural/release-workflow.test.ts:1 — retain each absent matrix credential as a named non-gating skip, add workflow-level enforcement that at least one provider credential is available, and make a credential-present selected-file gate run fail unless that credentialed leg executes assertions
### Task rem-completeness-prehalt-1: src/conductor/test/fixtures/live-e2e-run-body.test.ts:541 and src/conductor/test/fixtures/live-e2e-run-body.ts:358-361 — add a production-path case that seeds .pipeline/HALT before the shared live E2E run body executes and asserts zero provider dispatches, DONE remains absent, HALT remains present, and no successful terminal state is reported
### Task rem-completeness-claude-home-auth-1: src/conductor/src/execution/llm-provider.ts:120-127, src/conductor/src/execution/claude-provider.ts:488, and src/conductor/test/fixtures/live-provider-home.ts:21-27 — extend the provider-owned self-host auth contract to Claude and implement ClaudeProvider.prepareSelfHostAuth so the selected CLAUDE_CODE_OAUTH_TOKEN is re-injected into the isolated child environment after ambient credentials are stripped; update src/conductor/test/fixtures/live-provider-home.test.ts:1 to instantiate the real ClaudeProvider and assert its childEnv contains only the Claude credential while CODEX_API_KEY remains absent
### Task rem-completeness-claude-auth-source-1: src/conductor/src/execution/claude-provider.ts:488, src/conductor/test/fixtures/live-e2e-providers.ts:26-42, and src/conductor/test/fixtures/live-e2e-run-body.ts:263-270 — expose non-secret Claude authentication-source state from the real ClaudeProvider and resolve the descriptor assertion from that state instead of returning the expected literal; update src/conductor/test/fixtures/live-e2e-run-body.test.ts:1 with a Claude mismatch case that fails naming both expected and resolved authentication sources
### Task rem-completeness-smoke-capability-docs-1: docs/contributing/testing.md:343-363 — update the smoke-tier file count and file list, replace the removed credentialed capability with credentialed:claude and credentialed:codex in the closed capability table and gate prose, and document npm run smoke -- <smoke_file> as the production single-file selection argument
### Task rem-completeness-workflow-gating-docs-1: docs/contributing/testing.md:105-110 — replace the require_credentials failure semantics with the delivered workflow contract: each absent matrix credential is a provider-named non-gating skip, each credential-present leg remains gate-enforced, and the separate require-live-provider-credential job requires at least one provider credential overall
### Task rem-build-review-claude-wiring-1: src/conductor/test/acceptance/daemon-e2e-live-agent-tier.acceptance.test.ts:43-64 — replace fixture-source greps with an executable assertion that constructs the Claude descriptor provider through LIVE_E2E_PROVIDERS and verifies the real ClaudeProvider authenticationSource and prepareSelfHostAuth results, so reverting src/conductor/src/execution/claude-provider.ts fails
### Task rem-build-review-token-cap-1: src/conductor/test/acceptance/daemon-e2e-live-agent-tier.acceptance.test.ts:67-80 and src/conductor/test/fixtures/live-e2e-run-body.test.ts:1 — replace regex checks for assertion spellings with injected-dependency executions of the shared run body that prove accumulated metered tokens are reported and an over-cap result fails independently of the workflow wall-clock timeout
### Task rem-build-review-shared-diagnostics-1: src/conductor/test/acceptance/daemon-e2e-live-agent-tier.acceptance.test.ts:86-96 and src/conductor/test/fixtures/live-e2e-run-body.test.ts:1 — replace import-text and local-function absence checks with an execution of the shared failure path using the existing dumpPipelineDiagnostics mock, asserting terminal state and task-evidence diagnostics are emitted through that shared implementation
### Task rem-build-review-shared-body-1: src/conductor/test/structural/live-e2e-shared-body.test.ts:15-109 — remove verbatim shared-body and leg-file substring assertions, retain the AST-level provider-branch scan, and execute the shared body once per descriptor with equivalent injected outcomes to prove descriptor-only legs share provider selection, authentication, and diagnostics behavior
### Task rem-build-review-claude-auth-source-1: src/conductor/test/fixtures/live-e2e-providers.test.ts:24-36 — instantiate the real Claude provider with and without CLAUDE_CODE_OAUTH_TOKEN and assert authenticationSource returns oauth-token and missing respectively, making a revert of src/conductor/src/execution/claude-provider.ts:506 fail
### Task rem-build-review-complete-smoke-tier-1: .github/workflows/live-daemon-e2e.yml:78-87, src/conductor/test/structural/release-workflow.test.ts:1, and docs/contributing/releases.md:93 — add a release-gating invocation that still runs the complete npm smoke tier while preserving the per-provider selected-file matrix legs, prove both paths structurally, and align the canonical release-gate description with the resulting job layout
### Task rem-build-review-smoke-doc-semantics-1: docs/contributing/testing.md:343-363 — replace the removed bare credentialed capability with credentialed:claude and credentialed:codex and document that an absent-credential selected-file leg is a passing non-gating skip, while aggregate enforcement applies to full-tier runs and selected credential-present legs remain gate-enforced
