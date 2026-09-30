# Sequence: Independent opt-in and invalid configuration

**Last updated:** 2026-09-30
**Status:** Approved by operator in composer chat, 2026-09-30
**Scope:** Existing OTel enablement cannot enable logs, and invalid log configuration cannot disable valid traces or metrics.

## Diagram

```mermaid
sequenceDiagram
    participant Entry as Execution entry
    participant Config as Configuration resolution
    participant Existing as Existing traces and metrics
    participant Local as Local diagnostics
    participant Logs as Log export ownership
    participant Pending as Retained log delivery
    Entry->>Config: Resolve existing telemetry and separate log control
    Config-->>Existing: Existing signal configuration
    alt Log control absent or false
        Config-->>Entry: Log sending disabled
        Entry->>Pending: Do not send retained logs
        Note over Logs: No sending log owner is attached
        Entry->>Local: Existing local output continues
    else Log control malformed or enabled destination invalid
        Config-->>Entry: Named log configuration error
        Entry->>Local: Report the error without credentials
        Entry->>Pending: Do not send retained logs
        Note over Logs: No implicit opt-in or fallback destination
    else Log control explicitly true and destination valid
        Config-->>Entry: Valid log enablement
        Entry->>Logs: Attach shared log owner
        Entry->>Pending: Authorize delivery under the approved retention policy
    end
    Note over Existing: A log-only setting does not change valid trace or metric behavior
```

## Legend

Enablement and validation are independent logical results; the concrete configuration shape belongs to architecture review. Disabled-log behavior includes retained batches. The architecture review must resolve how the existing shared delivery runtime enforces this rule across process ownership changes; no record is authorized merely because it exists on disk.

## Requirement Coverage

FR-1, FR-6, FR-7, and FR-10.

## Change Log

| Date | Change | Reason |
| --- | --- | --- |
| 2026-09-30 | Initial proposal | DECIDE for #1935 after operator approval of the PRD |
