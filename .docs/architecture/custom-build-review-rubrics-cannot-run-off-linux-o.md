# Components: custom build_review laps run in provider read-only review mode with detect-and-discard

**Last updated:** 2026-09-24
**Scope:** How a `build_review` lap that includes an enabled custom rubric protects its review inputs
on every platform. The per-lap bubblewrap containment boundary (probe, mount profile, scratch
provider home, env allowlist) is retired. Protection moves to three things: each provider's own
read-only review mode, an engine-owned integrity digest of the lap's inputs taken before fan-out
and checked after the join, and a host capability check that reports an unavailable read-only mode
before any review fault is spent. Built-in-only laps, ordinary BUILD, and non-review steps are
untouched.

## Diagram

```mermaid
graph TD
    subgraph Config["Config load · daemon start · daemon status"]
        CFG["build_review.custom_rubrics<br/>enabled members + candidate providers"]
        CAP["Read-only review capability check<br/>per provider named by an enabled custom member<br/>platform named in the result"]
        REPORT["Up-front report<br/>config warning · daemon log · status line<br/>ConductorEvent"]
    end

    subgraph Lap["build_review lap with a custom member (step-runners)"]
        MAT["Frozen view materialization<br/>baseline + head detached worktrees (unchanged)"]
        DIG1["Integrity digest BEFORE fan-out<br/>frozen head · frozen baseline · captured + installed policy<br/>engine evidence present at fan-out"]
        FAN["Fan-out: custom members + built-in peers<br/>ordinary provider environment (no scratch HOME, no env allowlist)"]
        DIG2["Integrity digest AFTER join"]
        GATE{"digests equal?"}
        ACCEPT["verdicts proceed to aggregate / adjudicator (unchanged)"]
        DISCARD["discard every member verdict of the lap<br/>closed cause review-input-mutated<br/>names the changed inputs"]
    end

    subgraph Providers["Provider adapters: read-only review invoke option"]
        CL["Claude: --restricted · tools Read/Grep/Glob/Bash<br/>allow rules: read-only git only · strict MCP config<br/>never skip-permissions"]
        CX["Codex: sandbox_mode read-only<br/>approval never"]
        NA["candidate whose read-only mode is unavailable<br/>existing setup-unavailable skip, setupCapability read-only review<br/>next candidate tried (provider-execution)"]
    end

    subgraph Faults["Mechanical-fault lane (adr-2026-08-18)"]
        UNAV["read-only-review-unavailable<br/>deterministic: charged once, never retried"]
        MUT["review-input-mutated<br/>closed cause, lap publishes no PASS"]
        HALT["needs-human HALT naming platform / changed inputs<br/>reduced-coverage record remains the way past"]
    end

    subgraph Retired["Retired for custom laps"]
        BWRAP["build-review-containment.ts<br/>bwrap probe incl. nested-sandbox-available"]
        SCR["scratch provider home + env allowlist"]
    end

    CFG --> CAP --> REPORT
    CAP -. same check .-> NA
    MAT --> DIG1 --> FAN
    FAN --> CL
    FAN --> CX
    FAN --> NA
    NA -- no candidate left --> UNAV
    CL --> DIG2
    CX --> DIG2
    DIG2 --> GATE
    GATE -- yes --> ACCEPT
    GATE -- no --> DISCARD --> MUT
    UNAV --> HALT
    MUT --> HALT
    BWRAP -. replaced by .-> CL
    BWRAP -. replaced by .-> CX
    SCR -. replaced by .-> FAN
```

## Legend

- **Read-only review mode** is an engine-owned invoke option that each provider adapter maps to its
  native mechanism. It is provider-enforced, not OS-proven. Reads of host state and sibling evidence
  are limited only by the provider's tool set (adr-2026-09-10-portable-build-review-policy D5 as
  amended by this feature).
- **Integrity digest** is engine evidence under the lap's existing build-review evidence root. It
  catches a write that gets past a provider's read-only mode. Because members share one frozen view
  and run concurrently, a mismatch cannot be attributed to one member, so the whole lap is discarded.
- **Capability check** runs the provider's own read-only mechanism once and observes both sides: a
  process can start, and a write is refused. The result names `process.platform` and the reason.
  There is no hand-written platform table.
- Dotted edges show what replaces the retired components.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-24 | Initial generation | #2735 DECIDE: detect-and-discard replaces bubblewrap review containment |
| 2026-09-24 | Plan update: setup-unavailable skip path, Claude read-only git allow rules, digest excludes the feature checkout | /plan and conflict-check resolutions |
