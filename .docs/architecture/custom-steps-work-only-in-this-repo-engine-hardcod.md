# Components: Custom steps without engine-reserved names or paths (#1344)

**Last updated:** 2026-09-20
**Scope:** The four places the engine binds custom-step behavior to this repository — the FINISH
release-readiness observer (`finish-publication-production.ts:137-158`), the
`releaseDispositionFlowActive()` predicate and its four call sites (`conductor.ts:2789`, `:6336`,
`:6542`, `:6594`, defined `:6355`), custom-step prompt construction (`step-runners.ts:828-836`),
and the release modules re-exported from the package entry
point (`index.ts:5-9`) — plus the three GitHub Actions workflows that import them
(`release-metadata.yml:36`, `release-pr.yml:68`, `release.yml:47,163`). Generic custom-step
declaration, ordering, dispatch, `hooks`, and enforcement (`types/config.ts:104-126`,
`engine/hooks.ts`) are shown only as the unchanged baseline the change relies on.

## Diagram

```mermaid
graph TD
    subgraph Config["Project configuration — UNCHANGED schema, no new key"]
        DECL["steps.«name»<br/>after, skill, enforcement,<br/>completion_artifact, hooks"]
        SH["self_host.release_artifact_gate<br/>existing key, default true"]
    end

    subgraph Generic["General engine — works for every repository"]
        ORD["step ordering<br/>steps.ts<br/>UNCHANGED"]
        DISP["custom-step dispatch<br/>step-runners.ts<br/>CHANGED: invokes the skill named by the<br/>configured SKILL.md frontmatter, with the<br/>provider prefix; was slash plus step key.<br/>Unresolvable: fail closed by name"]
        OBS["FINISH prerequisite observer<br/>finish-publication-production.ts<br/>CHANGED: every gating custom step<br/>that declares completion_artifact,<br/>not the name 'release-disposition'"]
        FIN["FINISH publication coordinator<br/>finish-publication.ts<br/>UNCHANGED verdict vocabulary:<br/>valid, missing, invalid, indeterminate"]
        HALT["operator-visible refusal<br/>CHANGED: reason names the<br/>unsatisfied step key"]
    end

    subgraph SelfHost["engine/self-host — this repository only"]
        FLOW["release-metadata flow activation<br/>CHANGED: self-build AND release gate on,<br/>no skill-path literal.<br/>Step absent or renamed: halt by name"]
        SNAP["PR-body Release-* snapshot / restore<br/>MOVED out of conductor.ts"]
        GATE["release-gate.ts<br/>UNCHANGED contract"]
        ACT["release actions entry point<br/>NEW module: re-exports check, pr,<br/>candidates, renderer, publisher"]
    end

    subgraph Shared["Shared parser — stays in general engine"]
        META["release-metadata.ts<br/>never exported from index.ts.<br/>Also read by engineer handoff for<br/>repositories whose PR template opts in"]
        INJ["engineer/release-metadata-inject.ts<br/>UNCHANGED"]
    end

    subgraph Surface["Package public surface"]
        IDX["index.ts main entry<br/>CHANGED: release exports removed"]
    end

    subgraph CI["This repository's workflows"]
        WF["release-metadata.yml, release-pr.yml,<br/>release.yml<br/>CHANGED: import the self-host<br/>release actions entry point"]
    end

    DECL --> ORD
    ORD --> DISP
    DECL --> DISP
    DECL --> OBS
    OBS --> FIN
    FIN --> HALT
    SH --> FLOW
    DECL --> FLOW
    FLOW --> SNAP
    FLOW --> GATE
    SNAP --> META
    GATE --> META
    ACT --> META
    INJ --> META
    WF --> ACT
    IDX -. "no longer re-exports" .-> ACT
```

## Sequence: FINISH prerequisite for a consumer's gating custom step

```mermaid
sequenceDiagram
    participant Op as Operator config
    participant Eng as Engine dispatch
    participant Step as Custom step «name»
    participant Obs as FINISH prerequisite observer
    participant Fin as FINISH coordinator

    Op->>Eng: steps.«name» with enforcement gating and completion_artifact
    Eng->>Step: dispatch skill, then hooks.after if declared
    Step-->>Eng: writes completion_artifact, state «name» = done
    Eng->>Fin: enter FINISH
    Fin->>Obs: observe prerequisites
    loop every gating custom step declaring completion_artifact
        Obs->>Obs: state is done, artifact is a regular file, mtime not before run start
    end
    alt all present
        Obs-->>Fin: present
        Fin-->>Eng: publication proceeds
    else any missing, stale, or malformed
        Obs-->>Fin: verdict plus the step key
        Fin-->>Eng: refuse, reason names the step
    end
    Note over Obs: No gating custom steps declared: present, exactly as today
```

## Legend

- **UNCHANGED / CHANGED / MOVED / NEW** mark the delta this spec introduces; unmarked edges exist
  today.
- **General engine** is code every consuming repository runs. **engine/self-host** is code that
  only executes for this repository's self-build; after this change it is the only place that
  knows the step name `release-disposition` or the `Release-*` field names at runtime.
- **Shared parser.** `release-metadata.ts` is not part of the move: it has never been on the
  public surface, and the engineer handoff path reads it for any registered repository whose
  `.github/pull_request_template.md` opts in. The architecture review confirmed it stays in the general
  engine.
- **Public surface** is `package.json` `main` → `dist/index.js`; the package declares no
  `exports` map, so the entry point's re-exports are the whole advertised API.
- Out of scope and absent from the diagram: step packages and installed step identity (#2615),
  PR-body customization for custom steps (#2616), and `runShipmentReconcileAction`, a
  workflow-only export of the same class that #1344 does not list.
- Guillemets mark placeholders (`«name»`).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-20 | Initial generation | DECIDE for #1344, Tier M |
| 2026-09-20 | Added the custom-step dispatch component | Architecture review found dispatch keyed on the step name; operator added it to scope |
