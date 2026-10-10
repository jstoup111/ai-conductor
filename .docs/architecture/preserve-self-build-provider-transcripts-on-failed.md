# Components: Preserve self-host provider transcripts

**Last updated:** 2026-10-10
**Scope:** Conductor components that capture, retain, prune, announce, and read self-host
provider transcripts (#611). Every self-host step and auxiliary member; Claude and Codex.

## Diagram

```mermaid
graph TD
    subgraph Providers["Provider catalog"]
        DESC["Self-host provider descriptor<br/>NEW: transcripts.globs allowlist<br/>Claude: projects/**/*.jsonl<br/>Codex: sessions/**/*.jsonl"]
    end

    subgraph Scratch["Self-host scratch lifecycle"]
        PE["provider-execution<br/>candidate finally"]
        PH["provider-home / sandbox-build-env<br/>teardown()"]
        REL["releaseScratchHome"]
        SW["Dead-owner sweep<br/>sweepScratch / sweepFeatureWorktreeScratch"]
        HV["NEW: TranscriptHarvester<br/>copy allowlisted files only"]
    end

    subgraph Verdict["Conductor verdict path"]
        CV["Step outcome<br/>step_completed / step_failed /<br/>build_stall / HALT"]
        RET["NEW: TranscriptRetention<br/>keep or prune by verdict + cap"]
    end

    subgraph Spine["Event spine"]
        EM["ConductorEventEmitter"]
        EV[".pipeline/events.jsonl"]
    end

    STORE[("«worktree»/.pipeline/transcripts/<br/>«step»/«runId»-a«n»[-«member»]/")]
    CLI["NEW: ai-conductor transcripts «slug»<br/>list captures, print final assistant message"]

    PE --> PH --> REL
    REL -- "before rm" --> HV
    SW -- "before reclaim" --> HV
    DESC -- "globs" --> HV
    HV -- "write" --> STORE
    HV -- "provider_transcripts_captured" --> EM
    CV --> RET
    RET -- "prune success-with-progress" --> STORE
    RET -- "provider_transcripts_retained / _pruned" --> EM
    EM --> EV
    CLI -- "read captures via events" --> EV
    CLI -- "read files" --> STORE
```

## Legend

- **NEW** marks components this feature adds; everything else exists today.
- The harvester runs inside the existing release/sweep paths; it never extends a scratch home's
  lifetime and never copies outside the descriptor's allowlist (scratch homes hold seeded
  credentials).
- Retention runs after the conductor's verdict, which is the only point where zero-progress
  (`build_stall` reason `no_task_progress`) is known.
- `«placeholders»` are variable path segments.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-10 | Initial generation | #611 — self-build transcripts deleted on teardown |
