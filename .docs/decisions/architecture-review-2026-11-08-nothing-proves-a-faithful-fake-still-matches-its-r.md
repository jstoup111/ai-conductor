# Architecture Review: Paired fake-and-real contracts for external boundaries (#1990)
**Date:** 2026-11-08
**Inputs reviewed:**
- The explore output and track marker (`.docs/track/nothing-proves-a-faithful-fake-still-matches-its-r.md`, technical).
- The approved diagram (`.docs/architecture/nothing-proves-a-faithful-fake-still-matches-its-r.md`).
- Intake #1990.

**Mode:** lightweight (Medium). Feasibility and alignment only.
**Verdict:** APPROVED

## Feasibility

- **Stack.** No new dependency. The harness is plain Vitest `describe`/`it` registration.
- **Prerequisites.** The boundary registry, `src/conductor/test/structural/boundary-registry.ts`,
  merged on `origin/main` in #3660. Its `BoundaryEntry` lists `llm` as `ported`, with adapters
  `execution/claude-provider.ts`, `execution/codex-provider.ts`, and `execution/pi-provider.ts`
  (verified via `git show origin/main:`). The root checkout's local `main` predates #3660, but the
  daemon builds from `origin/main`.
- **Real-leg execution.** The existing smoke target `npm run smoke` already provides what the real
  legs need (verified at `src/engine/smoke-runner.ts` and `src/engine/smoke-capability.ts`):
  - It discovers `*.smoke.test.ts` files.
  - It requires each to declare a `smokeCapability` from a closed set that includes
    `credentialed:claude`, `credentialed:codex`, and `credentialed:pi`.
  - It records `ran` or `skipped` per file in its outcome ledger.
- **Default-suite exclusion.** `vitest.smoke.config.ts` is the only config that includes smoke
  files. `test/structural/smoke-entry-point.test.ts` already fails any unmocked live-provider
  session outside a default-excluded `*.smoke.test.ts` file (verified).
- **CI exposure.** In the release workflow, the complete smoke tier force-skips the Claude and Codex
  credentialed capabilities, and it installs no Pi binary. The per-provider matrix names only the
  `daemon-e2e-live-*` files (`.github/workflows/live-daemon-e2e.yml`, verified). The new llm real
  legs therefore never run in CI (assumption A5 covers the Pi binary).
- **Coverage-test collision.** `test/structural/live-provider-coverage.test.ts` only enumerates
  `test/engine/daemon-e2e-live-*.smoke.test.ts`. Real legs under `test/contracts/` do not disturb
  it (verified).
- **Fake/real parity is testable.** All three real adapters declare identical static capabilities:
  `supportsSessionResume = false`, synchronous spawn permit, native output schema, and system-prompt
  delivery (verified at `claude-provider.ts:585`, `codex-provider.ts:304`, `pi-provider.ts:501`).
  The existing Codex fake mirrors the resume and spawn-permit behavior (verified). Each of these is
  observable on both sides without asserting nondeterministic model text (assumption A7).
- **Data, performance, worktree isolation.** No data. The fake leg is in-process and cheap. Real
  legs reuse the smoke runner's owned temporary scope (`scripts/smoke.ts`). No ports or shared
  state.

## Alignment

- **Governing ADR reused.** `adr-2026-11-07-external-boundary-ports-registry-and-ratchet` governs
  the registry and the per-boundary migrations. This feature adds one obligation to that same
  registry, so it is recorded as an additive amendment, D7, rather than a new ADR. Decisions 1 to 6
  are unchanged. No other open spec PR or composer worktree touches that ADR or the registry
  (checked 2026-11-08).
- **HARNESS.md test-isolation policy.** The design follows it: faithful fakes in the default tier,
  and real third parties only in named, opt-in smoke tests.
- **`adr-2026-10-07-conductor-decomposition-target-architecture` D5 / layer ratchet.** Unaffected.
  Every new file is under `src/conductor/test/`, which neither ratchet scans.
- **Production DI defaults.** There is no production change, so no fake can become a production
  default.
- **Mechanical enforcement.** The obligation is a structural test that fails at the point of
  violation, not prose guidance. This follows the repository's machinery-by-default principle.

### Focused local pattern basis

- **Shared faithful fake.** The pattern source is `test/fixtures/codex-provider-fake.ts`
  (`createCodexProviderFake`).
  - Traits to keep: it returns an `LLMProvider` object plus a recorded `calls` array, never launches
    a CLI, honors `spawnPermit` before any work, and declares the same capabilities as its real
    adapter.
  - Allowed variation: an adapter-specific fake script hook.
  - The new Claude and Pi fakes follow this shape.
- **Shared body, one file per provider.** The pattern source is the `defineLiveE2EProviderSmoke`
  pattern (`test/fixtures/live-e2e-run-body.ts`, and the `test/engine/daemon-e2e-live-*.smoke.test.ts`
  files).
  - Traits to keep: one shared body, with thin per-provider smoke files that each declare one
    credentialed capability.
  - Allowed variation: the body is a boundary contract rather than a daemon run.

## Wiring Surface

There is no new production surface. Every new primitive is test infrastructure, wired as follows:

- `test/contracts/boundary-contract.ts` (the harness) is called by each boundary's contract
  module.
- `test/contracts/llm.contract.ts` is imported by the fake-leg file and by each real-leg file.
- `test/contracts/llm.contract.test.ts` is discovered by the default Vitest config.
- `test/contracts/llm-{claude,codex,pi}.contract.smoke.test.ts` are discovered by
  `vitest.smoke.config.ts` through `npm run smoke`.
- `test/fixtures/claude-provider-fake.ts` and `test/fixtures/pi-provider-fake.ts` are imported by
  the fake leg.
- The `contract` field on `BoundaryEntry` is read by
  `test/structural/boundary-contract-obligation.test.ts`, which runs in the default tier.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A real-leg run spends tokens on every expectation | Integration | Medium | Low | Only model-invoking expectations spend. They use a minimal prompt and the existing live-e2e token cap (A6). |
| Expectations creep into nondeterministic model text and flake on real legs | Technical | Medium | Medium | Assert only `InvokeResult` structure and declared behavior, never model text content (A7). |
| A new fake drifts from its adapter between real-leg runs | Integration | Medium | Medium | This is the risk the feature surfaces. A real-leg failure names the boundary and the expectation. |
| A future local boundary's real leg (for example `hermetic` git) runs in the release smoke tier | Integration | Low | Low | Release CI already runs `hermetic` and `toolchain` smoke files, and local infrastructure is not a third party. |

## ADRs Created

No new ADR was created. One amendment was made: `adr-2026-11-07-external-boundary-ports-registry-and-ratchet` gains D7, the
paired fake-and-real contract obligation. Its assumptions ledger gains A5 to A7.

## Conditions

None.
