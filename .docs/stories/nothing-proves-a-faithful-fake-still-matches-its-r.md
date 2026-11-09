**Status:** Accepted

# Stories: Paired fake-and-real contracts for external boundaries (#1990)

Source: intake jstoup111/ai-conductor#1990. Track: technical. Governing decision:
`adr-2026-11-07-external-boundary-ports-registry-and-ratchet` D7 (amended 2026-11-08).

## Story 1: A boundary contract is written once and runs against any subject

**Requirement:** #1990 outcome 1 (divergence detectable by a named test target) and outcome 3 (failure identifies boundary and expectation)

As a harness maintainer, I want to define a boundary's contract once and run it unchanged against both a fake and a real adapter, so that both legs prove the same expectations.

### Acceptance Criteria

#### Happy Path
- Given a contract for boundary `llm` with expectations named `declares the adapter capabilities` and `completes a minimal invocation`, when it is run for adapter `claude` on the `fake` leg, then Vitest reports exactly one case per expectation, titled `llm contract [claude fake] › declares the adapter capabilities` and `llm contract [claude fake] › completes a minimal invocation`.
- Given the same contract module, when it is run for adapter `claude` on the `real` leg, then the cases carry the identical expectation names under the title prefix `llm contract [claude real] ›`.

#### Negative Paths
- Given a contract whose subject violates one expectation, when the leg runs, then only that expectation's case fails, its failure title names the boundary, the adapter, the leg, and the expectation, and every other expectation's case still runs and reports its own result.
- Given a contract that declares two expectations with the same name, when the contract is defined, then definition throws an error naming the boundary and the duplicated expectation, and no case is registered.
- Given a contract with no expectations, when the contract is defined, then definition throws an error naming the boundary and stating that the contract is empty.
- Given a leg whose subject factory throws, when the leg runs, then every expectation case of that leg fails with the factory error in its message, rather than the leg passing with zero assertions.

### Done When
- [ ] `src/conductor/test/contracts/boundary-contract.ts` exports the harness, and its unit tests cover the title format, a single failing expectation, a duplicate name, an empty contract, and a throwing subject factory.
- [ ] One contract module run on both legs produces case titles that differ only in the leg token.

## Story 2: The registry refuses a ported boundary without a paired contract

**Requirement:** #1990 outcome 1 (all eight boundaries covered as they are ported) and D7 obligation check

As a harness maintainer, I want the boundary registry to refuse any ported boundary that lacks a fake-and-real contract for every adapter, so that each per-boundary migration must ship its contract.

### Acceptance Criteria

#### Happy Path
- Given the registry with `llm` ported and its contract declaring one leg pair for each of `execution/claude-provider.ts`, `execution/codex-provider.ts` and `execution/pi-provider.ts`, when the default-tier obligation test runs, then it passes.
- Given a pending boundary such as `git` with a null contract, when the obligation test runs, then it raises no failure for that boundary.
- Given a pending boundary that declares a complete contract early, when the obligation test runs, then it applies the same checks as for a ported boundary and passes.

#### Negative Paths
- Given a boundary whose status is changed to ported while its contract stays null, when the obligation test runs, then it fails with a line naming that boundary and stating that a ported boundary has no contract.
- Given a ported boundary with one registered adapter module that has no leg pair, when the obligation test runs, then it fails naming the boundary and that adapter module.
- Given a leg pair naming an adapter module that the boundary does not register, when the obligation test runs, then it fails naming the boundary and the unregistered adapter.
- Given a leg pair whose fake module, fake-leg file, real-leg file, or contract module path does not exist, when the obligation test runs, then it fails naming the boundary and the missing path.
- Given a fake-leg file whose name ends in `.smoke.test.ts`, when the obligation test runs, then it fails naming the file and stating that a fake leg must run in the default tier.
- Given a real-leg file whose name does not end in `.smoke.test.ts`, when the obligation test runs, then it fails naming the file and stating that a real leg must be a smoke file.
- Given a real-leg file that declares no `smokeCapability`, when the obligation test runs, then it fails naming the file and stating that the capability declaration is missing.
- Given a fake-leg or real-leg file that does not import the boundary's contract module, when the obligation test runs, then it fails naming the file and the contract module it must import.
- Given several violations across boundaries, when the obligation test runs, then one failure lists every violation rather than stopping at the first.

### Done When
- [ ] `BoundaryEntry` in `src/conductor/test/structural/boundary-registry.ts` carries a `contract` field. It is null for the seven pending boundaries and populated for `llm`.
- [ ] `src/conductor/test/structural/boundary-contract-obligation.test.ts` runs in the default tier and has a fixture-driven case for each negative path above.

## Story 3: Claude and Pi have shared faithful fakes alongside the Codex fake

**Requirement:** D7 first contract (every llm adapter has a faithful fake)

As a test author, I want shared faithful fakes for the Claude and Pi adapters, matching the existing Codex fake, so that each llm adapter has a fake the contract can run against.

### Acceptance Criteria

#### Happy Path
- Given the Claude fake and the Pi fake, when they are constructed, then each returns an `LLMProvider` that declares the same session-resume, spawn-permit, native-schema and system-prompt capabilities as its real adapter, and exposes the recorded invocation calls.
- Given a permitted invocation with no script override, when either fake is invoked, then it records the call and returns a successful result with exit code 0 and non-empty output.
- Given an invocation that requests a native output schema, when any of the three fakes is invoked with a permitted spawn, then the result carries a terminal structured result. The existing Codex fake is corrected if it does not.

#### Negative Paths
- Given an invocation whose spawn permit is denied, when any of the three fakes is invoked, then the invocation rejects with an error naming the denial reason, as the real adapters do, records no call, and never notifies the spawn observer.
- Given any fake invocation, when it runs inside the default suite, then no provider executable is launched. The existing smoke-only structural check reports no unmocked live-provider session in the fake modules.
- Given a script override that returns a failed result, when the fake is invoked, then the fake returns that result unchanged and still records the call.

### Done When
- [ ] `src/conductor/test/fixtures/claude-provider-fake.ts` and `src/conductor/test/fixtures/pi-provider-fake.ts` exist and follow the `createCodexProviderFake` shape.
- [ ] All three fakes pass the llm contract fake leg (Story 4).

## Story 4: The default suite runs the llm contract against every llm fake

**Requirement:** #1990 outcome 1 and outcome 2 (default suite free of real calls)

As a harness maintainer, I want the default suite to run the llm contract against the Claude, Codex and Pi fakes, so that a fake that stops satisfying the contract fails CI.

### Acceptance Criteria

#### Happy Path
- Given the default test command, when it runs, then the llm contract fake leg runs for `claude`, `codex` and `pi`. Each runs the expectations `declares the adapter capabilities`, `refuses a denied spawn permit before spawning`, `completes a minimal invocation` and `returns a native-schema terminal result`, and all pass.
- Given the expectation `refuses a denied spawn permit before spawning`, when it runs, then it asserts that the invocation rejects with an error naming the denial reason and that the spawn observer was never notified.
- Given the expectation `completes a minimal invocation`, when it runs, then it asserts success, exit code 0 and non-empty output, and asserts nothing about the output text's content.

#### Negative Paths
- Given a fake changed to declare `supportsSessionResume: true`, when the default suite runs, then the case `llm contract [«adapter» fake] › declares the adapter capabilities` fails for that adapter only.
- Given a fake that resolves a result instead of rejecting for a denied spawn permit, when the default suite runs, then the case `llm contract [«adapter» fake] › refuses a denied spawn permit before spawning` fails for that adapter only.
- Given the default test command or the CI aggregate suite, when either runs, then no llm real-leg file is discovered or executed, and no Claude, Codex or Pi executable is spawned by the contract.

### Done When
- [ ] `src/conductor/test/contracts/llm.contract.ts` defines the four expectations against `LLMProvider`.
- [ ] `src/conductor/test/contracts/llm.contract.test.ts` runs the contract against the three fakes in the default tier.

## Story 5: An opt-in smoke run proves each real llm adapter against the same contract

**Requirement:** #1990 outcome 1, outcome 2 (real side explicitly opt-in) and outcome 3

As an operator, I want to run the llm contract against each real adapter on demand, so that a divergence between a fake and its real provider is caught before it surfaces as a live daemon failure.

### Acceptance Criteria

#### Happy Path
- Given Claude credentials and the `claude` binary are available, when the operator runs `npm run smoke` with the `llm-claude` real-leg file, then the llm contract runs against the real `ClaudeProvider`, and the smoke outcome ledger records that file as `ran` under `credentialed:claude`.
- Given the same for Codex and for Pi, when their real-leg files run, then each executes the same four expectations against `CodexProvider` or `PiProvider` under `credentialed:codex` or `credentialed:pi`.
- Given a real-leg run, when expectations that invoke the model complete, then their combined token use is reported and stays within the existing live-e2e token cap.

#### Negative Paths
- Given a real adapter whose observable behavior diverges from the contract, when its real leg runs, then the smoke run fails with a case titled `llm contract [«adapter» real] › «expectation»` that names the diverging expectation.
- Given the capability for an adapter is unmet (missing credential or missing binary) in advisory mode, when `npm run smoke` runs, then that real-leg file is recorded as `skipped` with the unmet requirement named, and the other legs still run.
- Given gate mode with only one adapter's real-leg file selected and that adapter's credential variable absent, when `npm run smoke` runs, then the ledger records the leg as skipped and names the missing credential variable. The run then fails with `Gate-mode smoke run executed no credentialed test files` rather than passing with no assertions.
- Given gate mode with an adapter's credential present but its binary absent, when that real-leg file runs, then the ledger records the leg as failed and names the missing binary.
- Given a real-leg run whose model-invoking expectations exceed the live-e2e token cap, when the leg finishes, then it fails with a message naming the cap and the observed token total.
- Given the expectation `refuses a denied spawn permit before spawning` on a real leg, when it runs, then no provider subprocess is started and no tokens are spent.

### Done When
- [ ] `src/conductor/test/contracts/llm-claude.contract.smoke.test.ts`, `llm-codex.contract.smoke.test.ts` and `llm-pi.contract.smoke.test.ts` exist. Each declares its `credentialed:«adapter»` capability and imports `llm.contract.ts`.
- [ ] Each real-leg file is excluded from default Vitest discovery and is discovered by the smoke config.
