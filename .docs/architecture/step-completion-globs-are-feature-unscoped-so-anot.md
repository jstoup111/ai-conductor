# Components: Feature-aware step artifact resolution

**Last updated:** 2026-07-28
**Scope:** Artifact declarations and the completion, interactive-review, and dashboard consumers affected by issue #993.

## Current architecture

```mermaid
graph LR
    REG["STEP_ARTIFACT_GLOBS<br/>StepName to string array"]
    RAW["findArtifactFiles<br/>pattern expansion only"]
    GATE["checkStepCompletion<br/>any match means done"]
    REVIEW["interactive artifact review<br/>reviews every match"]
    STATUS["getArtifactStatus<br/>any match means satisfied"]
    UI["terminal and create renderers"]
    ID["Existing feature identity<br/>featureDesc / activePlanPath / plan stem"]
    PLAN["Plan and story helpers<br/>feature-aware special cases"]
    FOREIGN["Unrelated prior-feature artifact"]

    REG --> RAW
    RAW --> GATE
    RAW --> REVIEW
    RAW --> STATUS --> UI
    FOREIGN --> RAW
    ID --> PLAN
    PLAN -.->|"not used by generic consumers"| RAW

    style FOREIGN fill:#c62828,color:#ffffff
    style GATE fill:#ef6c00,color:#ffffff
```

The registry mixes feature-authored documents, repository-wide documents, run-local evidence, and workspace-wide test files. The generic consumers cannot distinguish those scopes, so an unrelated feature document can satisfy a feature step.

## Target architecture

```mermaid
graph LR
    CONTRACTS["STEP_ARTIFACT_CONTRACTS<br/>patterns + scope + resolver strategy"]
    MATCH["findArtifactFiles<br/>raw pattern expansion"]
    IDENTITY["resolve current feature identity<br/>planPath / activePlanPath / featureDesc"]
    CHANGESET["buildArtifactResolutionContext<br/>merge-base + working tree paths"]
    RESOLVE["resolveArtifactFiles<br/>shared policy seam"]
    FEATURE["feature scope<br/>exact strategy match"]
    REPOSITORY["repository scope<br/>all declared matches"]
    RUN["run scope<br/>stable run-local evidence"]
    LEGACY["legacy compatibility<br/>singleton when unambiguous"]
    AMBIG["multiple unmatched candidates<br/>fail closed with reason"]
    GATE2["checkStepCompletion"]
    REVIEW2["interactive artifact review"]
    STATUS2["getArtifactStatus"]
    UI2["terminal and create renderers"]

    CONTRACTS --> RESOLVE
    MATCH --> RESOLVE
    IDENTITY --> RESOLVE
    CHANGESET --> RESOLVE
    RESOLVE --> FEATURE
    RESOLVE --> REPOSITORY
    RESOLVE --> RUN
    FEATURE --> LEGACY
    FEATURE --> AMBIG
    FEATURE --> GATE2
    FEATURE --> REVIEW2
    FEATURE --> STATUS2
    REPOSITORY --> GATE2
    REPOSITORY --> REVIEW2
    REPOSITORY --> STATUS2
    RUN --> GATE2
    RUN --> REVIEW2
    RUN --> STATUS2
    STATUS2 --> UI2

    style CONTRACTS fill:#2e7d32,color:#ffffff
    style RESOLVE fill:#2e7d32,color:#ffffff
    style AMBIG fill:#c62828,color:#ffffff
```

## Component responsibilities

| Component | Responsibility |
|---|---|
| `STEP_ARTIFACT_CONTRACTS` | Declare patterns, scope, and the artifact-family resolver strategy at one reviewable site. |
| `findArtifactFiles` | Expand patterns only; it carries no feature policy. |
| Feature identity resolver | Reuse the active plan path, plan stem, and feature description ladder already present in `artifacts.ts`. |
| Artifact resolution context builder | Assemble explicit identity and engine-owned Git change-set evidence once per completion, review, or renderer refresh. |
| `resolveArtifactFiles` | Apply the declared scope and resolver strategy, preserve unambiguous legacy artifacts, and report ambiguity instead of guessing. |
| Completion, review, and status consumers | Consume the same resolved file set while retaining their distinct pass/prompt/render behavior. |

## Legend

- Green nodes are the new shared declaration and resolution seam.
- Orange marks the current false-positive completion consumer.
- Red marks unsafe foreign-artifact input or the target fail-closed ambiguity outcome.
- `repository` and `run` scopes preserve intentional non-feature artifacts; no blanket stem filter is introduced.

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-07-28 | Initial current/target component flow | DECIDE architecture for issue #993 |
| 2026-07-28 | Added the planned once-per-operation context builder | Plan tasks 4, 8, 10, and 11 make feature and change-set inputs explicit without per-pattern Git discovery |
