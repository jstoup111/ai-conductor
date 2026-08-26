# Components: Hard-delete the retired wiring_check step name

**Last updated:** 2026-08-26
**Scope:** The second phase owed by `adr-2026-08-11-deprecated-no-op-step-retirement`: removing the
`wiring_check` name from the step registry, the BUILD verification fan-out, the event unions, and
every step-keyed surface. No new machinery — this diagram shows the fan-out shape before and after.

## Diagram — current state

```mermaid
graph TD
    subgraph Build["BUILD"]
        BUILDSTEP["build"]
        subgraph Group["BUILD_VERIFICATION_GROUP (steps.ts:350)"]
            WCHECK["wiring_check<br/>deprecated no-op<br/>short-circuit at step-runners.ts:738"]
            TSUITE["test_suite"]
        end
        JOIN["group join<br/>.pipeline/gates/«member».json"]
        BREVIEW["build_review<br/>prerequisites: wiring_check, test_suite"]
    end

    BUILDSTEP --> WCHECK
    BUILDSTEP --> TSUITE
    WCHECK -- "unconditional pass<br/>artifacts.ts:3205" --> JOIN
    TSUITE --> JOIN
    JOIN --> BREVIEW

    subgraph Surfaces["Step-keyed surfaces carrying the dead name"]
        EVENTS["types/events.ts:685,696<br/>member: 'wiring_check' | 'test_suite'"]
        CONFIG["resolved-config.ts:50,81<br/>retries + autonomy defaults"]
        POLICY["provider-model-policy.ts"]
        TABLE["model-table-metadata.ts → HARNESS.md table"]
        CLI["daemon-cli.ts:2360 renderer"]
    end
```

## Diagram — after this change

```mermaid
graph TD
    subgraph Build["BUILD"]
        BUILDSTEP["build"]
        TSUITE["test_suite<br/>sole deterministic BUILD verification"]
        BREVIEW["build_review<br/>prerequisites: test_suite"]
    end

    BUILDSTEP --> TSUITE
    TSUITE --> BREVIEW

    subgraph Removed["Deleted with the name"]
        GONE1["wiring_check registry entry (steps.ts)"]
        GONE2["step-runners.ts short-circuit"]
        GONE3["unconditional-pass predicate (artifacts.ts)"]
        GONE4["config/policy/model-table entries"]
        GONE5["'wiring_check' literal in events.ts member unions"]
    end

    subgraph Unchanged["Unchanged"]
        TYPO["getStepDefinition typo guard<br/>Unknown step: «name» still throws"]
        HIST[(historical .pipeline/gates/wiring_check.json<br/>and past parallel_started events<br/>plain JSON, never re-validated)]
    end
```

Whether `BUILD_VERIFICATION_GROUP` survives as a one-member group or is dissolved into a direct
`build → test_suite → build_review` edge is decided in architecture review; the rendered fan-out is
identical either way.

## Legend

- Solid arrows: dispatch/prerequisite order.
- «name» — placeholder for a variable step name.
- "Removed" nodes are deletions, not new components.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-26 | Initial generation | DECIDE for #1896 (hard deletion phase of the wiring_check retirement) |
