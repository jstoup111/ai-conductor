# Components: Parallel Task-Stream Dispatch — target dispatch boundaries (#474 spec-lock, #552)

**Last updated:** 2026-07-12
**Scope:** The TARGET architecture #474 will implement post-v1, as pinned by this spec's
ADRs. Shows the batch-boundary stream detector, GroupCore reuse (#469), the additive
dual-stamp attribution path, and the join back into the serial loop. Everything not
marked NEW is the existing engine, unchanged in v1. This is a DECIDE-only spec — no
component here ships in v1; the diagram exists so the pinned interfaces are visible.

## Diagram

```mermaid
graph TD
    subgraph Loop["conductor.ts build loop (serial walk, unchanged)"]
        BB["batch boundary<br/>plan tasks ready set"]
        JOINED["batch complete<br/>serial loop resumes"]
    end

    subgraph Detect["NEW stream detector (mechanical, no LLM)"]
        SD["detectStreams<br/>inputs: plan dependency edges +<br/>per-task backtick path sets<br/>hard file-overlap veto - any intersection means sequential"]
        CAP["cap = build_concurrency<br/>NEW config key, default 1 (= serial, dormant)<br/>resolve + clamp + allow-list<br/>precedent: validation_concurrency"]
    end

    subgraph Core["GroupCore (#469, the ONLY parallel executor)"]
        GC["capped fan-out<br/>fresh session per stream<br/>single-writer state<br/>shared rate-limit episode"]
    end

    subgraph Streams["per-stream dispatch (shared worktree, write-disjoint by veto)"]
        S1["stream «a» agent<br/>own TDD cycle"]
        S2["stream «b» agent<br/>own TDD cycle"]
    end

    subgraph Stamps["additive dual-stamp attribution (NEW, generated assets only)"]
        SCALAR["scalar .pipeline/current-task<br/>EXISTING - stays authoritative when serial"]
        DIR["per-stream stamps<br/>.pipeline/current-task.d/«stream-id»<br/>NEW namespace, absent when serial"]
        HOOK["generated prepare-commit-msg + session hooks<br/>resolve stream stamp first, scalar fallback<br/>new asset versions - existing contracts untouched"]
    end

    subgraph Status["task state (additive fields only)"]
        TS["task-status.json rows<br/>optional stream field added<br/>schema already tolerates extras"]
        TE["task-evidence.json<br/>evidence gate derivation UNCHANGED<br/>completion never trusts rows"]
    end

    BB --> SD
    SD --> CAP
    CAP -->|"streams ≥ 2 and cap ≥ 2"| GC
    CAP -->|"otherwise"| SERIAL["existing serial dispatch<br/>byte-for-byte v1 behavior"]
    GC --> S1
    GC --> S2
    S1 --> DIR
    S2 --> DIR
    SERIAL --> SCALAR
    DIR --> HOOK
    SCALAR --> HOOK
    HOOK -->|"Task: «id» trailer"| TE
    S1 --> TS
    S2 --> TS
    GC --> JOINED
    SERIAL --> JOINED
```

## Legend

- **NEW** — components #474 adds post-v1. Nothing NEW ships in v1; the spec pins their
  interface shapes so they land as MINOR with no migration block.
- **build_concurrency** — new top-level `.ai-conductor/config.yml` key; default 1 keeps the
  feature dormant, so its addition is additive. Follows the `validation_concurrency`
  resolve+clamp+allow-list precedent from #469's APPROVED GroupCore ADR.
- **Dual stamp** — the scalar `.pipeline/current-task` file is untouched and remains the
  only stamp in serial mode; parallel streams each get `.pipeline/current-task.d/«stream-id»`.
  Generated hooks (engine-provisioned per worktree) gain stream-first resolution with scalar
  fallback — shipped as NEW generated asset content, never edits to consumer-owned hooks.
- **File-overlap veto** — stream detection is deterministic: dependency-edge independence AND
  empty pairwise intersection of per-task declared path sets; any overlap collapses to serial.
- **Evidence gate unchanged** — completion continues to derive from `task-evidence.json`
  stamps (H6–H8 invariants); `task-status.json` only gains optional fields.
- `«…»` — placeholder for a variable value.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-12 | Initial generation | DECIDE phase for #552 (#474 interface spec-lock) |
