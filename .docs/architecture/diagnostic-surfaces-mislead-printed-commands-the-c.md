# Components & Sequences: Accepted remediation commands and durable episode-HALT stamps

**Last updated:** 2026-10-10
**Scope:** (1) The conductor CLI's printed remediation commands, routed through one builder whose
outputs are proven to parse by the CLI's own grammar. (2) Episode-caused HALT recovery made durable
across a daemon restart via a per-worktree stamp. Source: jstoup111/ai-conductor#1023.

## Component Diagram (L3)

```mermaid
graph TD
  subgraph cliproc["Conductor CLI (src/conductor/src)"]
    builder["remediation-commands.ts (NEW)<br/>formatRemediationCommand(kind)<br/>inline set + pre-guard set"]
    guidance["remediation-guidance.ts (NEW)<br/>four guidance formatters"]
    index["index.ts<br/>orphaned-state / diagnose guidance<br/>(today: hand-written ai-conductor --reset)"]
    grammar["cli.ts<br/>detectInline + parseArgs<br/>(existing grammar)"]
    guard["bare-form guard<br/>index.ts (rejects non-inline, exit 1)"]
  end

  subgraph tests["Test machinery (NEW)"]
    parsetest["builder parse test<br/>every builder output → detectInline + parseArgs"]
    srccheck["source check<br/>rejects hand-written command literals<br/>in CLI guidance strings"]
  end

  index -->|prints guidance via| guidance
  guidance -->|commands from| builder
  parsetest -->|enumerates| builder
  parsetest -->|parses with| grammar
  parsetest -->|asserts not refused by| guard
  srccheck -->|scans| index

  subgraph daemonproc["Daemon process (one per repo)"]
    daemon["daemon.ts<br/>collect halted/error → park<br/>onHaltWritten(slug, episodeCaused)"]
    episode["RateLimitEpisode<br/>(in-memory, deadline untilMs)"]
    tracker["episode-halt-tracker.ts (CHANGED)<br/>in-memory Set → durable stamp store"]
    startup["daemon startup (NEW hook)<br/>recover stamped HALTs whose<br/>episode deadline has passed"]
    endsweep["idle-tick sweep (CHANGED)<br/>maintenance.afterIdlePoll while no episode →<br/>recoverEpisodeHalts, retains unclassified"]
    clear["clearMarker (daemon-rekick.ts)<br/>HALT → HALT.cleared, rm HALT.class,<br/>rm episode stamp (CHANGED)"]
  end

  subgraph wt["Feature worktree .pipeline/"]
    halt["HALT"]
    hclass["HALT.class"]
    stamp["HALT.episode (NEW)<br/>episode deadline + HALT identity"]
  end

  daemon -->|reads active + deadline| episode
  daemon -->|stamp when episode-caused| tracker
  tracker -->|write / read / remove| stamp
  startup -->|list stamps| tracker
  endsweep -->|list stamps| tracker
  startup -->|precedence checks, then| clear
  endsweep -->|precedence checks, then| clear
  tracker -.->|stamp valid only if it matches| halt
  endsweep -.->|operator-action class keeps HALT| hclass
  clear -->|removes| stamp
```

## Sequence: episode-caused HALT survives a daemon restart

```mermaid
sequenceDiagram
  participant D1 as Daemon (process 1)
  participant E as RateLimitEpisode
  participant T as Episode stamp store
  participant W as Worktree .pipeline/
  participant D2 as Daemon (process 2, after restart)

  D1->>E: active()? deadline?
  E-->>D1: true, untilMs = «deadline»
  D1->>W: feature halted (HALT written by step)
  D1->>T: stamp(slug, «deadline», HALT identity)
  T->>W: write HALT.episode
  Note over D1: daemon restarts — in-memory episode and tracker are lost
  D2->>T: startup: list stamps
  T->>W: read HALT.episode for each worktree
  alt deadline passed AND stamp matches current HALT AND not parked AND class not operator-action
    D2->>W: clearMarker → HALT.cleared + REKICK, rm HALT.class + HALT.episode
    Note over D2: feature re-dispatches via existing rekick path
  else deadline not yet passed
    Note over D2: left stamped — the episode-end or next-startup sweep recovers it
  else stamp stale (HALT replaced or cleared by operator) OR parked OR operator-action class
    D2->>W: HALT retained for a human (stale stamp discarded)
  end
```

## Legend

- **NEW** / **CHANGED** mark code introduced or modified by this feature; all other nodes exist today.
- `HALT.episode` is durable **state** ("this HALT was caused by a rate-limit episode ending at
  «deadline»"), not an occurrence — event-spine exception C, the same category as `HALT.class`. The
  existing `loop_halt` / park events on `events.jsonl` are unchanged.
- **HALT identity** binds a stamp to the specific HALT it was written for, so a stamp left behind
  after an operator `rm -f .pipeline/HALT` can never clear a later, human-caused HALT.
- Precedence is unchanged from today's sweep: operator park and operator-action HALT classes
  outrank automatic recovery.
- The source check covers the CLI guidance strings the operator is told to run; the parse test is
  the proof that each builder output is accepted rather than refused by the bare-form guard.
- `«deadline»` is a runtime value, not a literal.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-10 | Plan update: guidance module, idle-tick trigger, unclassified retention | /plan for #1023 |
| 2026-10-10 | Initial generation | Feature design for #1023 (remediation-command builder, durable episode-HALT stamp) |
