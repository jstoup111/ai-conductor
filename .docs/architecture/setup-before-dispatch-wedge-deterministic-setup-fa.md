# Components: Setup-failure triage at the worktree-prepare seam (#446)

**Last updated:** 2026-07-09
**Scope:** Components touched by the setup-before-dispatch wedge fix — deterministic
quarantine of uncommitted breakage plus one bounded fix-session for committed breakage,
inserted where `bin/setup` failure currently hard-errors the feature.

## Diagram

```mermaid
graph TD
    subgraph Dispatch["Feature dispatch - engine/daemon-runner.ts"]
        RUNF["makeRunFeature<br/>CHANGED - setup failure now routes to triage<br/>instead of generic error-park"]
        BUILD["runConductor build<br/>UNCHANGED"]
    end

    subgraph Prepare["engine/worktree-prepare.ts"]
        PREP["prepareWorktree<br/>CHANGED - failure carries classified<br/>SetupFailure with stderr tail"]
        SETUP["bin/setup execution<br/>UNCHANGED script contract"]
    end

    subgraph Triage["engine/setup-triage.ts - NEW"]
        CLASSIFY["Tree classifier<br/>git status porcelain - dirty vs clean"]
        QUAR["Quarantine step<br/>preserve ALL uncommitted and untracked state,<br/>reset to HEAD, re-run setup ONCE"]
        FIXG["Fix-session gate<br/>one bounded dispatch, explicit success contract,<br/>mirrors the gated rebase resolver"]
    end

    QREF["Quarantine ref<br/>wip/setup-quarantine-«slug» commit<br/>NEW artifact - never discarded, named in logs"]
    FIXA["Fix-session agent<br/>NEW dispatch surface - prompt is setup stderr tail,<br/>success = bin/setup exit 0 with fix committed"]
    HALTM[".pipeline/HALT marker<br/>UNCHANGED sink - now names setup error<br/>and quarantine ref"]
    WTREUSE["ensureWorktree reuse<br/>daemon-deps.ts - UNCHANGED,<br/>kept broken tree returns on re-dispatch"]

    WTREUSE --> RUNF
    RUNF --> PREP
    PREP --> SETUP
    SETUP -- "exit 0" --> BUILD
    SETUP -- "non-zero exit" --> CLASSIFY
    CLASSIFY -- "dirty tree" --> QUAR
    QUAR -- "preserve first" --> QREF
    QUAR -- "retry passes" --> BUILD
    QUAR -- "still failing at clean HEAD" --> FIXG
    CLASSIFY -- "already clean" --> FIXG
    FIXG --> FIXA
    FIXA -- "contract met" --> BUILD
    FIXA -- "contract failed" --> HALTM
    QREF -. "surfaced to resuming agent" .-> BUILD
```

## Legend

- **NEW** nodes are introduced by this feature; **CHANGED** nodes are modified; **UNCHANGED**
  nodes are load-bearing context.
- Solid arrows: control flow. Dotted arrow: information surfaced, not control.
- Stage 1 (classifier + quarantine) is pure machinery — no LLM. Stage 2 (fix-session) is the
  one LLM dispatch, bounded to a single attempt per rotation, following the gated `/rebase`
  resolver shape.
- Preserve-then-heal discipline mirrors `leak-triage.ts` (#380/#435): nothing is deleted or
  reset before it is preserved and named.
- Invariant delivered: `bin/setup` exit 0 ⇒ byte-for-byte the pre-fix dispatch path (zero
  happy-path change). A feature can no longer loop error→rekick→error on the same tree state.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-09 | Initial generation | DECIDE phase for issue jstoup111/ai-conductor#446 |
