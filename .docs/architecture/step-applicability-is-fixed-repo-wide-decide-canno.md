# Components: per-feature step applicability

**Last updated:** 2026-10-03
**Scope:** How a DECIDE-authored per-feature declaration that a step is inapplicable flows from
the spec worktree, through the land gate and the operator-merged spec PR, into the daemon's
base-tree marker read, and finally into dispatch-time skipping with a distinct recorded outcome on
the existing event spine. Tier, track, and repository-wide disable paths are shown only where the
new path sits beside them; their behavior is unchanged.

## Diagram

```mermaid
graph TD
    subgraph Decide["DECIDE (spec worktree)"]
        AUTH["DECIDE author<br/>writes per-feature applicability marker<br/>one row per step · non-empty reason"]
        MK["NEW applicability marker<br/>.docs/applicability/«stem».md"]
    end

    subgraph Config["Repo config (engine/config.ts · resolved-config.ts)"]
        TOG["NEW feature_applicability.enabled<br/>project-only · default off"]
        SD["Step metadata (engine/steps.ts · types/steps.ts)<br/>existing configDisableAllowed<br/>NEW featureInapplicableAllowed: acceptance_specs · manual_test only"]
    end

    subgraph Land["Land gate (engine/engineer/land-spec.ts)"]
        LV{"NEW validateApplicability (engine/feature-applicability.ts)<br/>shared by land and backlog<br/>toggle on · known step · declarable<br/>non-empty reason · no duplicates"}
        LE["landGateError<br/>names offending row"]
    end

    PR["Spec PR<br/>operator review + merge = authority"]

    subgraph Daemon["Daemon backlog (engine/daemon-backlog.ts)"]
        BT["Base-branch tree read<br/>readFeatureMarker (tier · track · NEW applicability)"]
        WHO["NEW resolveMarkerDecider (owner-gate/merge-time.ts)<br/>author · committer · sha of latest<br/>first-parent base commit touching the marker"]
        ST["Feature state (mutation port)<br/>complexity_tier · track<br/>NEW applicability_declarations seed + base hash<br/>NEW feature_inapplicable honored record"]
    end

    subgraph Dispatch["Dispatch loop (engine/conductor.ts)"]
        SEL{"Skip resolution<br/>tier · track · config disable · upstream<br/>NEW per-feature inapplicable"}
        LATE{"NEW step already started<br/>for this feature?"}
        RS["recordStepSkip<br/>+ recordSkipVerdict for loop gates"]
        REF["NEW late declaration refused<br/>prior outcome stands"]
        RUN["Step runs normally"]
    end

    subgraph Spine["Event spine (unchanged channel)"]
        EV["NEW step_inapplicable event<br/>step · reason · decider"]
        IGN["NEW applicability ignored / refused event<br/>branch-only marker · late declaration"]
        VIEW["status views · events.jsonl · OTel"]
    end

    AUTH --> MK --> LV
    TOG --> LV
    SD --> LV
    LV -- invalid --> LE
    LV -- valid --> PR --> BT
    BT --> WHO --> ST
    BT --> ST
    TOG --> SEL
    SD --> SEL
    ST --> SEL
    SEL -- declared inapplicable --> LATE
    SEL -- not declared --> RUN
    LATE -- no --> RS --> EV
    LATE -- yes --> REF --> IGN
    EV --> VIEW
    IGN --> VIEW
```

## Legend

- **NEW** marks components or fields this feature adds; unlabelled nodes exist today.
- `«stem»` is the feature's plan stem (equals the slug).
- The marker location, the decider-attribution source, and whether "inapplicable" is a new step
  status or a new skip cause are proposed here and decided in architecture-review.
- The spec PR merge is the operator authority: the daemon reads markers only from the base-branch
  tree, so a marker present only on a feature branch or worktree is never honored.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-03 | Initial generation | #1789 per-feature step applicability DECIDE |
| 2026-10-03 | Plan update: declarable set narrowed, shared validator, two state fields, decider helper | Conflict-check resolution and plan |
