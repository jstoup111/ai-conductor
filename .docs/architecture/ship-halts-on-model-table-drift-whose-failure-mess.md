# Architecture: Bounded mechanical-remediation lane in the self-host release gate

**Last updated:** 2026-09-06
**Scope:** The self-host release gate's integrity sub-gate (TR-8) and the new bounded
self-heal path between it and the terminal HALT. Covers issue #658.

## Diagram

```mermaid
sequenceDiagram
    autonumber
    participant C as Conductor (SHIP tail)
    participant G as runReleaseArtifactGate
    participant S as test_harness_integrity.sh
    participant R as remediation records
    participant A as allowlist (engine constant)
    participant W as build worktree (git)
    participant E as ConductorEventEmitter
    participant H as writeSelfHostHalt

    C->>G: releaseGate(projectRoot = harnessRoot = worktree)
    G->>S: run suite (bounded by timeoutMs)
    S-->>R: per-failed-check record «check», «remediation», «deterministic»
    S-->>G: exit code

    alt exit 0
        G-->>C: ok — proceed to TR-10 migration sub-gate
    else exit non-zero
        G->>R: read declared records
        alt no records, or any failed check not deterministic
            G->>E: self_heal_declined (reason: undeclared failure)
            G->>H: HALT — harness integrity suite failed
            H-->>C: needs-human
        else every failed check declared a remediation
            G->>A: validate every declared command
            alt any command not allowlisted
                G->>E: self_heal_declined (reason: command not allowlisted)
                G->>H: HALT — naming the rejected command
                H-->>C: needs-human
            else all commands allowlisted
                G->>E: self_heal_attempted (commands, checks)
                G->>W: run each allowlisted command
                G->>W: commit regenerated result
                G->>S: re-run suite ONCE
                alt re-run exits 0
                    G->>E: self_heal_succeeded
                    G-->>C: ok — proceed to TR-10 migration sub-gate
                else re-run still fails
                    G->>E: self_heal_failed
                    G->>H: HALT — self-heal did not clear the suite
                    H-->>C: needs-human
                end
            end
        end
    end
```

## Legend

- **remediation records** — machine-readable per-failure output emitted by
  `test/test_harness_integrity.sh` alongside its existing human-readable `FAIL` lines. Each
  record names the check, the remediation command, and whether that command is deterministic
  and side-effect-free.
- **allowlist** — a reviewed engine-side constant enumerating the commands the gate is
  permitted to execute. The suite declares intent; only the engine decides what may run. This
  is the trust boundary: the suite is content from the diff under review, the allowlist is not.
- **bounded** — exactly one self-heal attempt per gate run. A failed re-run HALTs; it never
  loops. This mirrors the bounded mechanical-fault allowance already used by `build_review`.
- **worktree** — on a self-host build `projectRoot`, `harnessRoot`, and the git repository the
  gate commits into are all the feature worktree, which the live boundary excludes. The gate
  never writes to the live root checkout.
- **fail-closed** — every branch that cannot prove the failure is mechanically remediable
  reaches the existing terminal HALT unchanged. The lane only ever converts a HALT into a
  pass, never a failure into a silent skip.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-06 | Initial generation | Feature design for #658 — self-heal or route mechanical release-gate remediation instead of terminally halting |
