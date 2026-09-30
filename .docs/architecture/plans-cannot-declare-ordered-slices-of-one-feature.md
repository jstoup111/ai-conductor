# Sequence: Plan slice manifest — declared, validated at land, re-validated on reseal

**Last updated:** 2026-09-29
**Scope:** How a plan declares ordered slices (#2723), which single component judges a slice
declaration, the two points that call it (engineer land, and `coverage_binding` after an operator
reseal of an amended plan), and how the default-off `stacked_prs.enabled` config key is loaded.
No build, FINISH, or publication behavior changes here — those consume the manifest in #2724+.

## Diagram

```mermaid
sequenceDiagram
    participant Author as plan skill (author)
    participant Plan as .docs/plans/«stem».md
    participant Land as engineer land (land-spec.ts)
    participant Slices as validatePlanSlices (plan-slices.ts)
    participant Grammar as plan-task-parse.ts
    participant Reseal as conduct reseal (reseal-cli.ts)
    participant CB as coverage_binding runner
    participant Env as coverage-binding envelope
    participant Spine as ConductorEventEmitter
    participant Config as loadProjectConfig (config.ts)

    Author->>Plan: optional "## Slices" table before the first task

    rect rgb(235, 245, 255)
        Land->>Plan: read plan
        Land->>Slices: validate slice declaration
        Slices->>Grammar: task ids (TASK_HEADER_PATTERN)
        Slices->>Grammar: per-task Dependencies (strict, sliced plans only)
        alt no Slices section
            Slices-->>Land: unsliced, valid
        else malformed, unknown id, or over the bound
            Slices-->>Land: violations naming slice, task, and rule
            Land-->>Author: land REFUSED (plan-slices)
        else well-formed
            Slices-->>Land: ordered slices
            Land-->>Plan: commit and spec PR
        end
    end

    rect rgb(245, 240, 255)
        Reseal->>CB: void coverage_binding (changed DECIDE path)
        CB->>Plan: read amended plan
        CB->>Slices: same validator, same plan text
        alt violations
            CB-->>Reseal: refused needs-human, naming the violations
        else valid
            CB->>Env: read prior slice membership
            CB->>Env: record current slice membership
            CB->>Spine: plan_slices_changed (moved, added, removed tasks)
        end
    end

    rect rgb(240, 240, 240)
        Config->>Config: stacked_prs.enabled boolean, default false
        Note over Config: unknown sub-key or non-boolean is a validation_error naming the key
    end
```

## Legend

- **`validatePlanSlices`** (new `plan-slices.ts`) is the single owner of "is this slice
  declaration well-formed". Land and `coverage_binding` call the same function on the same plan
  text, so the two can never disagree (the #1744 shared-predicate precedent).
- **`plan-task-parse.ts`** stays the source of task ids. The validator reuses
  `TASK_HEADER_PATTERN` and the shared task-reference resolver rather than a second task grammar.
  Strict `**Dependencies:**` parsing is new, and it runs only when a plan declares slices, so
  existing plans with free-form dependency prose are untouched.
- The **blue band** is the land refusal, which fires before a spec PR exists. It runs whether or
  not `stacked_prs.enabled` is on, so a plan that lands can never become invalid when the flag is
  later turned on.
- The **purple band** is the #1700 path. An operator reseal of an amended plan voids
  `coverage_binding`, and its runner re-validates the slices before the build continues. Slice
  membership is recorded in the envelope, and a change (including a dropped manifest) is emitted
  on the event spine, never silently accepted.
- The **grey band** is config load only. The key has no runtime reader in this feature; the
  consumer registry records it as reserved for #2724.

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-09-29 | Initial diagram. | Make the single slice validator and its two call sites explicit before implementation (#2723). |
