# Components: Pi Self-Host Isolation (#1887)

**Last updated:** 2026-10-03
**Scope:** The self-host isolation components a Pi self-build touches. The catalog declares each
provider's self-host shape, and the conductor, provider home and live boundary read it. Pi's
credential is resolved by Pi into a throwaway home. The flow is in
[sequences/self-host-builds-isolate-and-fingerprint-pi-operat](sequences/self-host-builds-isolate-and-fingerprint-pi-operat.md).

## Diagram

```mermaid
graph TD
    subgraph Catalog["execution/provider-catalog.ts"]
        Desc["selfHost descriptors<br/>claude · codex · pi"]
        Shape["selfHostShape<br/>isolation · selectedAuthPath ·<br/>claudeBuildPreflights · agentsSkillsLink · scrubVariables"]
        Desc --> Shape
    end

    subgraph PiAdapter["Pi adapter"]
        PiProv["PiProvider<br/>prepareSelfHostAuth · resolveSelfHostExecutable"]
        PiAuth["pi-self-host-auth.ts<br/>pi auth print-api-key → one-entry auth.json"]
        PiProv --> PiAuth
    end

    subgraph Engine["engine"]
        Cond["conductor.ts<br/>prepareCandidateSelfHost · self-host preflights"]
        Home["self-host/provider-home.ts<br/>throwaway home · env scrub · skills copy"]
        Scratch["self-host/provider-scratch.ts<br/>lease · teardown · sweep"]
        LB["self-host/live-boundary.ts<br/>PROVIDER_STATE_VOLATILE table"]
    end

    OpHome[("Operator ~/.pi/agent")]
    IsoHome[("Worktree .daemon/scratch/«attempt»-pi/self-host-pi-«random»")]

    Cond -- reads --> Shape
    Home -- reads --> Shape
    LB -- reads --> Shape
    Cond --> LB
    Cond --> Home
    Home --> Scratch
    Home -- auth hook --> PiProv
    PiAuth -- resolves key from --> OpHome
    PiAuth -- writes 0600 --> IsoHome
    LB -- fingerprints --> OpHome
    Home -- creates --> IsoHome
```

## Legend

- Cylinders are filesystem state. `«attempt»` and `«random»` are placeholders.
- "reads" edges replace the provider-id, home-variable and env-prefix comparisons these modules
  made before #1887 (adr-2026-09-24-built-in-provider-catalog-and-boot-discovery D24).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-03 | Initial component view | DECIDE architecture for issue #1887 |
