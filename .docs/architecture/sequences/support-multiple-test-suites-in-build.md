# Sequence: Support multiple test suites in BUILD

**Last updated:** 2026-09-11
**Scope:** Aggregate execution, proof reuse, invalid configuration, and first-failure handling for #2358.
**Review status:** Approved by James Stoup in composer chat, 2026-09-11.

## Diagram

```mermaid
sequenceDiagram
    participant Caller as Existing verification caller
    participant Verifier as FullSuiteVerifier
    participant Config as Configuration and ordered entries
    participant Proof as Fingerprint and evidence
    participant Runner as Existing command runner
    participant Bus as Existing event spine
    Caller->>Verifier: Inspect verification
    Verifier->>Config: Validate declaration and execution contexts
    alt Invalid declaration
        Config-->>Verifier: Error naming entry and setting
        Verifier-->>Caller: Refuse without running commands
    else Valid declaration
        Config-->>Verifier: Ordered aggregate entries
        Verifier->>Proof: Inspect current collection fingerprint and complete proof
        Proof-->>Verifier: Current, preserved, stale, or unusable
        Verifier-->>Caller: Inspection result
        Caller->>Verifier: Ensure using this inspection
        Note over Verifier: Existing aggregate lock covers ensure
        alt Current or preserved complete proof
            Verifier-->>Caller: Reused aggregate PASS
            Caller->>Bus: Existing reuse or preservation reporting
        else Execution required
            loop Each entry until first failure
                Verifier->>Runner: Run entry with its directory and timeout
                Runner-->>Verifier: Exit result after cleanup, duration, diagnostics
            end
            alt Every entry succeeded
                Verifier->>Proof: Atomically persist complete collection PASS and read back
                Verifier-->>Caller: Aggregate PASS with entry results
            else An entry failed or execution was incomplete
                Verifier->>Proof: Atomically persist FAIL and read back
                Verifier-->>Caller: Failed entry, attempted results, unexecuted remainder
            end
            Caller->>Bus: Attributable verification outcome
            Note over Caller: Existing BUILD failure route consumes the same result
        end
    end
```

## Legend

- Verifier-to-runner arrows include the ordered executor responsibility shown in the component diagram; they do not introduce a second process runner.
- A timeout, signal, launch failure, or nonzero exit ends the collection. Later entries do not run and cannot be represented as passing.
- A persistence/read-back failure is a verifier failure, never an aggregate PASS, even after all processes exit successfully.
- The reuse path launches no command. Existing freshness and drift-budget rules remain authoritative; any declaration change belongs to unbudgetable project-configuration drift.
- Preflight failure evidence and lock ownership retain the existing verifier's behavior. The invalid-declaration branch abbreviates that machinery and shows the required no-execution outcome.
- A run interrupted before durable completion cannot create reusable collection proof. No partial-pass resume cache is introduced.

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-09-11 | Proposed ordered execution and attributable terminal result flow | Preserve proof and failure semantics while adding multiple suites |
