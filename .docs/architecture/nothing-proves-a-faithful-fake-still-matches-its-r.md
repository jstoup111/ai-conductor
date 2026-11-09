# Components: Paired fake-and-real boundary contracts (#1990)

**Last updated:** 2026-11-08
**Scope:** The paired-contract test mechanism for external boundaries in `src/conductor/test/`.
A contract is defined once and run in two legs:

- **Fake leg:** against the boundary's faithful fake, in the default Vitest tier.
- **Real leg:** against the real adapter, as an opt-in smoke file.

The boundary registry gains a contract obligation for every `ported` boundary. This spec ships the
`llm` contract for the Claude, Codex, and Pi adapters. The seven pending boundaries inherit the
obligation when their migrations (#3043, #3633–#3639) set them `ported`. Plan stem:
`nothing-proves-a-faithful-fake-still-matches-its-r`. There is no production (`src/`) change.

## Diagram

### Components

```mermaid
graph LR
  subgraph REG["test/structural/"]
    registry["boundary-registry.ts<br/>BOUNDARY_REGISTRY entry gains<br/>contract: suite + one leg per adapter"]
    obligation["boundary-contract-obligation.ts<br/>pure checker, plus its test<br/>default tier"]
  end
  subgraph CONTRACTS["test/contracts/"]
    harness["boundary-contract.ts<br/>defineBoundaryContract<br/>names «boundary» › «expectation»"]
    suite["llm.contract.ts<br/>expectations written once<br/>against LLMProvider"]
    fakeLeg["llm.contract.test.ts<br/>fake leg, default tier"]
    realLeg["llm-«adapter».contract.smoke.test.ts<br/>real leg per adapter<br/>declares credentialed:«adapter»"]
    realBody["llm-real-leg.ts<br/>shared real-leg body<br/>token meter + live-e2e cap"]
  end
  subgraph FAKES["test/fixtures/"]
    fakes["claude-provider-fake.ts (new)<br/>codex-provider-fake.ts (existing)<br/>pi-provider-fake.ts (new)"]
  end
  subgraph EXEC["src/execution/ (unchanged)"]
    adapters["ClaudeProvider, CodexProvider,<br/>PiProvider"]
  end
  smoke(["npm run smoke<br/>opt-in, capability-gated"])
  ci(["Default suite and CI<br/>no real external calls"])

  harness --> suite
  suite --> fakeLeg
  suite --> realLeg
  fakeLeg --> fakes
  realLeg --> realBody
  realBody --> adapters
  fakeLeg --> ci
  realLeg --> smoke
  registry --> obligation
  obligation -.->|verifies files exist,<br/>legs share the suite,<br/>real leg is a smoke file| fakeLeg
  obligation -.-> realLeg
```

### Obligation verdict per registry entry

```mermaid
graph TD
  entry["Registry entry for boundary B"] --> ported{"B status is ported?"}
  ported -- no --> skip["No obligation<br/>pending #N carries it forward"]
  ported -- yes --> hasContract{"B declares a contract?"}
  hasContract -- no --> failMissing["Fail: names B,<br/>missing contract"]
  hasContract -- yes --> perAdapter{"Every adapter module of B<br/>has one leg pairing a fake<br/>and a real smoke file?"}
  perAdapter -- no --> failLeg["Fail: names B and the<br/>adapter without a leg"]
  perAdapter -- yes --> shape{"Fake leg is a default-tier file,<br/>real leg matches the smoke pattern,<br/>both import B's one suite?"}
  shape -- no --> failShape["Fail: names B, the file,<br/>and the violated rule"]
  shape -- yes --> ok["Pass"]
```

### Real-leg divergence report

```mermaid
sequenceDiagram
  participant Op as Operator
  participant Smoke as npm run smoke
  participant Leg as llm-«adapter» real leg
  participant Suite as llm.contract.ts
  participant Real as Real adapter
  Op->>Smoke: run with credentialed:«adapter» available
  Smoke->>Leg: execute declared capability file
  Leg->>Suite: run every expectation against Real
  Suite->>Real: invoke per expectation
  Real-->>Suite: InvokeResult
  Suite-->>Smoke: failure titled llm contract [«adapter» real] › «expectation»
  Smoke-->>Op: outcome ledger plus failing boundary and expectation
```

## Legend

- **Fake leg:** runs in the default suite and CI, and never spawns a real provider.
- **Real leg:** a `*.smoke.test.ts` file. It runs only under `npm run smoke` when its declared
  capability is met, and otherwise it is skipped and recorded as skipped in the smoke ledger.
- Dashed arrows are structural checks that read files. Solid arrows are runtime calls.
- `«adapter»` is one of `claude`, `codex`, or `pi`.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-11-08 | Initial generation | Intake #1990 DECIDE |
