**Status:** Accepted

# Stories: Live daemon E2E tier covers only Claude — no real-agent Codex signal

**Feature:** live-daemon-e2e-tier-covers-only-claude-no-real-ag (jstoup111/ai-conductor#1264)
**Tier:** M · **Track:** technical (no PRD — acceptance criteria live here)
**Approved ADRs:** `adr-2026-08-12-per-provider-live-smoke-legs`,
`adr-2026-08-12-live-provider-coverage-from-plugin-registry`

Requirement tags reference the issue's stated desired outcomes, 1-based in the order the
bullets appear under its **Desired outcome** heading:

| Tag | Desired outcome |
|---|---|
| DO-1 | The live tier produces a pass/fail verdict for a real Codex agent driving the same committed fixture through the same claim-to-finish path, not only for Claude |
| DO-2 | A Codex run is bounded by the same cost ceiling the Claude run is, and reports its observed cost on success |
| DO-3 | A Codex failure prints the same daemon log excerpt and pipeline state the Claude leg prints, so the failing seam is identifiable from CI output alone |
| DO-4 | Each provider's verdict is independent: one provider's missing credential or absent CLI never suppresses, fails, or masks the other's result |
| DO-5 | Whatever invocation runs the live tier covers every supported provider, so adding a provider to the harness cannot silently leave it uncovered |

---

## Story 1: A real Codex agent drives the committed fixture to a successful terminal state

**Requirement:** DO-1

As the maintainer of the live daemon E2E tier, I want a real Codex agent to drive the same
committed `daemon-e2e` fixture through the same `runDaemon` claim-to-finish path the Claude leg
drives, so that Codex's real output shapes are exercised against the pipeline instead of being
assumed equivalent to Claude's.

### Acceptance Criteria

#### Happy Path
- Given the `codex` binary is on `PATH` and a Codex credential is present, when the live tier
  runs the Codex leg, then the run reaches a successful terminal state — `.pipeline/DONE`
  present, `.pipeline/HALT` absent, and no park marker for the fixture slug.
- Given the Codex leg has completed successfully, when its resulting commit is inspected, then
  `madeCommit`, `touchedFixture`, and `taskTrailer` are all true — the same four assertion keys
  the Claude leg asserts, with no key relaxed or removed for Codex.
- Given the Codex leg is running, when the fixture is seeded, then it is seeded from the same
  committed `test/fixtures/daemon-e2e/plan.md` and `stories.md` the Claude leg uses, and Task 1's
  deliverable `touched.txt` is absent from the baseline tree.
- Given the Codex leg dispatches, when the step commands are resolved, then the preflight resolves
  every registry-derived command against the provisioned home using the Codex rendering (`$name`),
  not the Claude rendering (`/name`).

#### Negative Paths
- Given `CODEX_API_KEY` is set in the environment, when the leg constructs its provider, then the
  provider's resolved authentication source matches the source declared in the Codex descriptor
  (`api-key`); if the resolved source is `cached-login`, the leg fails naming both the expected
  and the resolved source rather than proceeding — because `CodexProvider` resolves
  authentication in its constructor, a leg that constructs before the key is present would
  silently degrade to a cached login that does not exist in CI. The assertion is the uniform
  descriptor-driven one from Story 2, not Codex-specific logic.
- Given no cached Codex login file exists and no API key is set, when the leg attempts to prepare
  self-host auth, then it fails naming the missing credential and the path it searched, and
  performs zero paid dispatches.
- Given the `codex` binary is absent from `PATH`, when the live tier runs, then the Codex leg
  reports an unmet toolchain requirement naming `codex`, and does not attempt provisioning.
- Given `codex doctor` reports an unready or probe-failed state, when the leg would dispatch,
  then it fails before any paid dispatch, and the failure names the readiness state and its
  remediation text rather than surfacing a generic non-zero exit.
- Given a Codex dispatch returns without producing the fixture's required commit, when the leg
  asserts its outcome, then the failure is reported as an outcome failure distinct from an
  unresolved-command failure, and the run's diagnostics are dumped.
- Given the Codex leg's provisioned home is created, when the leg finishes on either the success
  or the failure branch, then the home is torn down and the checkout under test is byte-for-byte
  unchanged.

### Done When
- [ ] A live smoke file exists for Codex that constructs the real `CodexProvider` and drives
      `runDaemon` over the committed `test/fixtures/daemon-e2e/` fixture.
- [ ] The Codex leg asserts the identical outcome set as the Claude leg: `terminal`, `madeCommit`,
      `touchedFixture`, `taskTrailer` all true.
- [ ] The Codex leg asserts its resolved authentication source is `api-key` when `CODEX_API_KEY`
      is set, and fails naming the resolved source otherwise.
- [ ] The provisioned home is torn down on both the success and failure branches, verified by a
      test asserting the home directory no longer exists.
- [ ] No assertion in the Claude leg was weakened, removed, or made conditional to accommodate
      Codex.

---

## Story 2: Both legs run one shared body, so neither can drift from the other

**Requirement:** DO-1

As the maintainer of the live daemon E2E tier, I want both provider legs to execute one shared,
parameterized run body, so that the claim "both providers drive the same claim-to-finish path"
stays mechanically true instead of degrading into two copies that diverge.

### Acceptance Criteria

#### Happy Path
- Given the shared run body exists, when either leg runs, then the seed, provision, preflight,
  meter, `runDaemon`, and assert sequence executes from that single body — no leg carries its own
  copy of any of those steps.
- Given a provider descriptor supplies the provider construction, binary name, credential
  variable, self-host executable, and provider key, when a leg is defined, then the leg supplies
  only that descriptor and adds no provider-specific assertion logic.
- Given the extraction is complete, when the Claude leg runs, then no observable assertion it
  made before the extraction — terminal state, task-trailered commit, touched fixture, metering,
  token cap, or the unmetered-step allow-list — is weakened, removed, or made conditional. A
  *uniform* assertion added for every provider and derived from the descriptor is a permitted
  strengthening; a provider-specific assertion is not.
- Given a provider's expected authentication source is declared in its descriptor, when the
  shared body asserts it, then the assertion is written once and applies to every leg, taking its
  expected value from the descriptor rather than from a provider name test.

#### Negative Paths
- Given the extraction changes the live file's structure, when the existing ungated self-check
  cases in that file run in the ordinary suite, then all of them pass unchanged — token metering,
  the cap predicate, the successful-credentialed-run assertion, the unmetered-`finish` allow-list,
  transparent provider wrapping, self-host injection, preflight failure, post-preflight outcome
  failure, and the pre-halted-fixture case.
- Given a future edit adds a provider-specific branch inside the shared body, when the structural
  check runs, then it fails naming the branch — the body must stay provider-agnostic and take its
  differences only from the descriptor.
- Given a descriptor omits a required field, when a leg is constructed from it, then construction
  fails at type-check time rather than producing a leg that silently dispatches with a wrong
  executable or provider key.

### Done When
- [ ] One shared parameterized run body exists; both provider legs call it.
- [ ] Each provider leg's own source contains no seed, provision, preflight, meter, `runDaemon`,
      or assert logic — only a descriptor.
- [ ] The pre-existing ungated self-check cases pass unchanged, verified by running them before
      and after the extraction.
- [ ] A structural check rejects a provider-specific branch inside the shared body.

---

## Story 3: One provider's missing credential or absent CLI never touches the other's verdict

**Requirement:** DO-4

As a release engineer, I want each provider's live verdict resolved independently, so that a
Codex credential I have not added yet cannot suppress, fail, or mask the Claude signal that is
already gating my releases.

### Acceptance Criteria

#### Happy Path
- Given both credentials are present, when the smoke tier runs, then the ledger carries one
  outcome line per provider leg, each naming that leg's own file and capability.
- Given the Claude credential is present and the Codex credential is absent, when the smoke tier
  runs in advisory mode, then the Claude leg runs to a verdict and the Codex leg is recorded as
  skipped naming its own unmet credential — the Claude verdict is unaffected.
- Given the Codex credential is present and the Claude credential is absent, when the smoke tier
  runs, then the symmetric result holds: the Codex leg runs to a verdict and the Claude leg is
  recorded as skipped naming its own unmet credential.
- Given each provider leg declares its own capability, when capability resolution runs, then each
  leg's capability resolves against that provider's own credential variable in both advisory and
  gate mode.

#### Negative Paths
- Given the Codex leg fails outright, when the smoke tier finishes, then the Claude leg's own
  outcome line still reports its independent result, and the run's failure names the Codex file
  specifically rather than reporting an undifferentiated tier failure.
- Given the Claude leg fails outright, when the smoke tier finishes, then the Codex leg's outcome
  line is still emitted and still reflects only the Codex leg's own result.
- Given a developer runs the smoke tier locally with neither the `codex` binary nor a Codex
  credential, when the tier runs in advisory mode, then they still get a clean, complete run of
  every leg they can run, with the Codex leg's skip naming what was missing.
- Given the two legs run concurrently, when both provision their isolated homes, then neither
  leg's home, credential, or environment is visible to the other — each leg's child environment
  carries only its own provider's home variable and credential.

### Done When
- [ ] Each provider leg lives in its own smoke file declaring its own capability.
- [ ] Capability resolution maps each provider to its own credential variable in both advisory
      and gate mode; no hardcoded single-provider credential remains in the resolution path.
- [ ] A test proves the isolation in both directions: Claude-present/Codex-absent, and
      Codex-present/Claude-absent.
- [ ] A test proves that one leg failing outright leaves the other leg's outcome line intact and
      correct.

---

## Story 4: A Codex run is bounded by the same cost ceiling and reports what it spent

**Requirement:** DO-2

As a release engineer paying for these runs, I want the Codex leg bounded by the same cost
ceiling the Claude leg is and reporting its observed cost on success, so that adding a second
live provider cannot quietly double or unbound my release spend.

### Acceptance Criteria

#### Happy Path
- Given the Codex leg completes successfully, when the run finishes, then it reports its observed
  total alongside its dispatch count and the cap in force — the same reporting shape the Claude
  leg emits.
- Given the operator sets the documented cap override, when the Codex leg runs, then that override
  bounds the Codex leg, using the same mechanism and the same default as the Claude leg.
- Given the Codex leg's dispatches report usage, when the leg asserts a successful credentialed
  run, then it requires a non-zero dispatch count, non-zero turns, and non-zero tokens — the same
  floor the Claude leg requires.

#### Negative Paths
- Given the Codex leg's accumulated usage exceeds the cap, when the run finishes, then it fails
  naming the cap, the observed total, and the count of unmetered results — and it fails on both
  the success and the failure branch, so an over-spend cannot escape by way of an earlier error.
- Given a Codex dispatch before the publication boundary reports no usage at all, when the leg
  asserts its run, then it fails naming the step that went unmetered rather than treating absent
  usage as zero cost.
- Given an unmetered Codex dispatch cannot be attributed to any step, when the leg asserts its
  run, then it fails — an unattributable dispatch may never be excused by the publication-boundary
  allow-list.
- Given the Codex leg's usage reporting differs in shape from Claude's, when metering runs, then
  the shared meter still records it or reports it as unmetered; it never silently discards a
  Codex-shaped usage value it does not recognize.

### Done When
- [ ] The Codex leg is bounded by the same cap mechanism and default value as the Claude leg,
      with the same operator override honored.
- [ ] The Codex leg emits an observed-total line naming its total, dispatch count, and the cap.
- [ ] The cap assertion runs on both the success and failure branches of the Codex leg.
- [ ] A test proves an over-cap Codex total fails naming the cap, the observed total, and the
      unmetered count.

---

## Story 5: A Codex failure is diagnosable from CI output alone

**Requirement:** DO-3

As an engineer reading a red release run, I want a Codex failure to print the same daemon log
excerpt and pipeline state the Claude leg prints, so that I can identify the failing seam without
re-running anything locally.

### Acceptance Criteria

#### Happy Path
- Given the Codex leg fails for any reason, when the failure is reported, then the daemon log
  excerpt and pipeline state are dumped through the same provider-agnostic diagnostics path the
  Claude leg uses — not a Codex-specific copy.
- Given the Codex leg fails in CI, when the workflow step completes, then that leg's step summary
  identifies the Codex leg specifically, distinguishing it from the Claude leg's summary.
- Given a Codex readiness probe fails, when the failure is reported, then the provider's own
  readiness diagnostic — the probe failure kind and its facts — appears alongside the shared
  daemon diagnostics.

#### Negative Paths
- Given the Codex leg fails before the fixture worktree exists, when diagnostics are dumped, then
  the dump reports the absent state explicitly rather than throwing a secondary error that hides
  the original failure.
- Given the daemon log is empty or missing at failure time, when diagnostics are dumped, then the
  dump reports that fact and still prints whatever pipeline state exists.
- Given a Codex failure message contains credential-shaped text, when the failure is printed to
  CI output or the step summary, then no credential value appears — the output reports the
  credential's presence or absence only.
- Given both legs fail in the same run, when the workflow reports, then each leg's diagnostics are
  attributable to its own provider and are not interleaved into one indistinguishable block.

### Done When
- [ ] The Codex leg dumps diagnostics through the same shared path as the Claude leg, verified by
      a test asserting the dumped content includes both the daemon log excerpt and the pipeline
      state.
- [ ] The per-leg workflow step summary names the provider it reports on.
- [ ] A test proves no credential value reaches a log line, diagnostic, or step summary.
- [ ] A test proves diagnostics on a missing worktree or empty daemon log report the absence
      rather than throwing.

---

## Story 6: A registered provider cannot ship without a live leg

**Requirement:** DO-5

As the maintainer of this harness, I want a check that fails when a registered provider has no
live leg, so that adding a third provider cannot silently repeat the coverage gap that left Codex
untested for the life of this tier.

### Acceptance Criteria

#### Happy Path
- Given every registered `llm_provider` has a live leg and a capability entry, when the check
  runs in the ordinary test suite, then it passes.
- Given the check runs, when it enumerates providers, then it derives the provider set from the
  production registry the dispatch path itself reads — not from a hand-maintained list in the
  test.
- Given the check runs, when it executes, then it performs no live dispatch, requires no
  credential, requires no provider binary, and incurs no spend.

#### Negative Paths
- Given a third provider is registered with no live leg, when the check runs, then it fails
  naming that provider id and pointing at the descriptor manifest.
- Given a provider has a live leg but no capability entry, when the check runs, then it fails
  naming the missing capability entry — a leg the runner cannot resolve is not coverage.
- Given a provider's credential is absent from the environment, when the check runs, then it
  still passes — the coverage check is not credential-conditional, because a missing credential is
  a temporary environment state while a missing leg is a permanent repository gap.
- Given the descriptor manifest and the structural capability map disagree about which files
  exist, when the check runs, then it fails naming the disagreement rather than trusting either
  one — two inventories that can silently diverge are the failure this check exists to prevent.
- Given a provider is removed from the registry, when the check runs, then a leg left behind for
  the removed provider is reported, so the manifest cannot accumulate dead entries.

### Done When
- [ ] A structural test enumerates registered `llm_provider` ids from the production registry and
      asserts each has both a live leg and a capability entry.
- [ ] The test fails, with the provider named, when a registered provider has no leg — proven by
      a test that exercises the failing direction, not only the passing one.
- [ ] The test passes when a credential is absent, proven explicitly.
- [ ] The test runs in the ordinary suite with no credential, no binary, and no dispatch.
- [ ] The pre-existing hardcoded capability map and the descriptor manifest are reconciled so they
      cannot disagree.

---

## Story 7: Gate enforcement follows the credential, and the gate never degrades to an empty pass

**Requirement:** DO-4, DO-5

As a release engineer, I want a provider leg to become release-gating exactly when its credential
is present, so that an unproven provider cannot block my releases today and cannot be forgotten
into permanent non-coverage tomorrow.

### Acceptance Criteria

#### Happy Path
- Given a provider leg's credential is present, when the tier runs in gate mode, then that leg is
  enforced — its unmet capability or its failure fails the run.
- Given a provider leg's credential is absent, when the tier runs in gate mode, then that leg is
  recorded as an explicit, named non-gating skip in the ledger and in the workflow step summary,
  and the run is not failed by its absence.
- Given at least one credentialed leg ran, when the gate-mode run completes, then the existing
  requirement that a credentialed leg actually executed is satisfied by that leg.
- Given a credential is added for a previously non-gating provider, when the next gate-mode run
  executes, then that leg is enforced with no code change, no release, and no configuration edit.

#### Negative Paths
- Given no credentialed leg ran at all, when the gate-mode run completes, then it fails — the gate
  may never pass on an empty credentialed set, however many legs were skipped for absent
  credentials. This aggregate check is evaluated **after** every per-leg resolution, so per-leg
  tolerance of an absent credential and the aggregate requirement are ordered, not competing:
  a leg's absent credential is tolerated in its own resolution and then counted against the
  aggregate at the end of the run.
- Given every provider leg's credential is absent, when the tier runs in gate mode, then the run
  fails rather than reporting a green tier that verified nothing.
- Given a leg is force-skipped by an operator override, when the tier runs in gate mode, then that
  override is a failure, not a skip — an operator override may not be used to quietly de-gate a
  credentialed leg.
- Given a non-gating skip is recorded, when the run's output is read, then the skip names the
  provider and the specific credential variable that was unmet — a silent or unattributed skip is
  itself a failure of this story.

### Done When
- [ ] Gate-mode enforcement for a provider leg is derived from that provider's credential
      presence; no stored flag, marker file, or follow-up ticket controls it.
- [ ] A test proves a gate-mode run with zero credentialed legs executed fails.
- [ ] A test proves a credential-absent leg is recorded as a named non-gating skip rather than a
      failure, while a credential-present leg is enforced.
- [ ] A test proves an operator force-skip of a credentialed leg fails in gate mode.
- [ ] The workflow step summary reports each leg's gating state and the reason for a non-gating
      skip, without printing any credential value.
