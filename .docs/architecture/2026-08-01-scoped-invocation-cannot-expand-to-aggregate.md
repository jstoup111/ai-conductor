# Components: scoped test invocation cannot expand to the aggregate suite

**Last updated:** 2026-08-01
**Scope:** The test-invocation surface used during BUILD and build_review — how a scoped run
is requested, how a malformed aggregate-expanding command shape is rejected, and how the
already-built `FullSuiteVerifier` remains the single authority for aggregate runs. Scoped to
the invocation seam only; the verifier's internals (fingerprint, lock, evidence) are shown as
existing context and are not modified by this feature.

## Diagram

```mermaid
graph TD
  subgraph agents["Provider sessions (BUILD / build_review)"]
    maker["build session<br/>skills/pipeline, skills/tdd<br/>runs scoped RED/GREEN"]
    grader["build_review grader<br/>step-runners.ts:1718<br/>told to run scoped tests"]
  end

  subgraph iface["Invocation surface (THIS FEATURE)"]
    scoped["NEW scoped-run interface<br/>conduct-ts «scoped-run»<br/>engine builds argv; refuses empty selection"]
    shapechk["NEW template validator<br/>engine/config.ts<br/>scoped_command must carry «selectors»"]
    scripts["REPAIRED npm scripts<br/>src/conductor/package.json<br/>forwarded args reach the runner"]
  end

  subgraph engine["Engine aggregate authority (EXISTING, unmodified)"]
    cli["conduct-ts test-suite<br/>test-suite-cli.ts:60"]
    verifier["FullSuiteVerifier<br/>full-suite-verifier.ts:500<br/>ensure() / inspect()"]
    exec["full-suite-executor.ts:307<br/>executeFullSuite"]
    fp["full-suite-fingerprint.ts:572<br/>content-addressed digest"]
  end

  subgraph steps["BUILD verification group (EXISTING)"]
    wiring["wiring_check"]
    suite["test_suite gate<br/>conductor.ts runTestSuiteStep"]
    review["build_review"]
  end

  ev[("Evidence<br/>.pipeline/test-suite-evidence.json")]
  cfg[(".ai-conductor/config.yml<br/>test_suite.command (aggregate)<br/>scoped_command (NEW, templated)")]
  runner["Test runner<br/>vitest"]

  maker -->|"scoped file set"| scoped
  grader -->|"scoped file set"| scoped
  scoped -->|"builds argv itself"| runner
  scoped -.->|"aggregate fallback trigger<br/>routes, never expands"| cli

  cfg --> shapechk
  shapechk -->|"rejects shapes that<br/>swallow forwarded args"| cfg
  scripts --> runner

  cli --> verifier
  verifier --> exec
  verifier --> fp
  exec --> runner
  verifier --> ev

  suite --> verifier
  wiring --> review
  suite --> review
  ev -.->|"REUSED when fingerprint CURRENT"| verifier

  classDef new fill:#0b7285,stroke:#063d47,color:#ffffff
  classDef existing fill:#343a40,stroke:#16191c,color:#ffffff
  class scoped,shapechk,scripts new
  class cli,verifier,exec,fp,wiring,suite,review existing
```

## Sequence: a scoped run during BUILD

```mermaid
sequenceDiagram
  participant A as build / build_review session
  participant S as scoped-run interface
  participant R as vitest
  participant V as FullSuiteVerifier
  participant E as test-suite-evidence.json

  A->>S: request scoped run (selector list)
  alt selector list is empty
    S-->>A: REFUSED — empty selection is an aggregate run
    Note over S,A: fallback trigger 3 — route to the verifier instead
  else selectors present
    Note over S: engine substitutes into «selectors»,<br/>quotes each, assembles argv itself
    S->>R: run only the selected tests
    R-->>S: scoped result
    S-->>A: scoped PASS/FAIL
  end

  alt aggregate fallback trigger fires
    A->>V: conduct-ts test-suite
    V->>E: read persisted evidence + fingerprint
    alt fingerprint CURRENT
      E-->>V: usable PASS
      V-->>A: REUSED (no execution)
    else stale or missing
      V->>R: execute configured aggregate command
      R-->>V: exit status
      V->>E: write content-addressed evidence
      V-->>A: EXECUTED
    end
  end
```

## Legend

- **Teal nodes** are introduced or repaired by this feature; **dark nodes** already exist and
  are not modified.
- `«scoped-run»` is a placeholder for the interface's final verb, decided in `/plan`.
- `«selectors»` is the configured template's substitution point. Selectors are **opaque** to the
  engine — file paths for vitest/pytest/rspec, packages for `go test`, filter expressions for
  `dotnet test`. The engine substitutes and quotes them; it never interprets them.
- The dashed edge from the scoped-run interface to `conduct-ts test-suite` is the key
  invariant: a broad fallback is a **route to the shared verifier**, never an expansion of
  the scoped command in place.
- The dashed edge from evidence back to the verifier is the existing `REUSED` path — shown
  because it is what makes routing a fallback cheap, but it is out of this feature's scope.

## Why the invocation surface is a component boundary

The defect this feature fixes lives entirely at the seam between an agent's *intent* (run
these files) and the *command actually executed*. Today that translation happens inside an
npm script whose shape (`vitest run … && echo 'AGGREGATE_TEST_SUITE_PASS'`) causes npm's
`-- <args>` to be appended to the trailing `echo` rather than to the runner, so a scoped
intent silently becomes an aggregate run. Making the translation an owned interface, and
validating that no configured command can discard forwarded args, closes the seam
mechanically rather than by instruction.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-01 | Initial generation | DECIDE for intake #1173 — scoped commands must not expand to the aggregate suite |
| 2026-08-01 | Placeholder generalized from `«files»` to opaque `«selectors»`; empty-selection refusal added to the sequence | Operator challenge during architecture review: a file-path list cannot express scoped selection for `go test` (packages), `cargo test` (name filters), or `dotnet`/JVM (filter expressions) |
