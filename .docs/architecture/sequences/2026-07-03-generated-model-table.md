# Sequence: Model-Table Drift Check (integrity suite)

**Last updated:** 2026-07-03
**Scope:** The two new integrity-suite checks — table content drift and SKILL.md pin
agreement — including the degraded path when the conductor's dependencies are absent.

## Diagram

```mermaid
sequenceDiagram
    participant Suite as test_harness_integrity.sh
    participant Bin as bin/generate-model-table
    participant Tsx as tsx generate-model-table.ts
    participant RC as resolved-config.ts + metadata
    participant HMD as HARNESS.md

    Suite->>Suite: node_modules present in src/conductor?
    alt dependencies absent
        Suite-->>Suite: WARN «model-table checks skipped» and exit 0 for this section
    else dependencies present
        Suite->>Bin: run with check flag
        Bin->>Tsx: npx tsx (source only, no dist build)
        Tsx->>RC: import DEFAULT_STEP_MODELS, TIER_OVERRIDES, STEP_RATIONALE, EXTRA_MODEL_TABLE_ROWS
        Tsx->>Tsx: render table rows (engine rows + extra rows, tier suffixes like «fable (L)»)
        Tsx->>HMD: read region between BEGIN and END markers
        alt committed region equals generated output
            Bin-->>Suite: exit 0
        else drift detected
            Bin-->>Suite: exit 1 + unified diff
            Suite-->>Suite: FAIL «table drift — run bin/generate-model-table to regenerate»
        end
        Suite->>Bin: run with pins flag (emit engine defaults as JSON)
        Suite->>Suite: for each skills/«name»/SKILL.md with a model pin
        alt skill maps to an engine step and pin differs
            Suite-->>Suite: FAIL «pin disagrees with engine default»
        else skill in exemption list or pin agrees
            Suite-->>Suite: PASS
        end
    end
```

## Legend

- The suite never imports TypeScript itself — it shells to `bin/generate-model-table`, keeping
  the bash/TS boundary at one seam.
- «name», «fable (L)» are placeholder slugs, not literals.
- Degraded path is a warning by design: consumer checkouts without `npm install` in
  `src/conductor` must not see a false integrity failure.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-03 | Initial generation | DECIDE phase for intake jstoup111/ai-conductor#187 |
