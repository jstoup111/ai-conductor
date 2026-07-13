# Components: Wiring reachability gate (#462)

**Last updated:** 2026-07-12
**Scope:** The green-but-unwired guard — where the wiring decision originates (architecture-review),
where the engine-parsed contract lives (plan `Wired-into:` lines), and the new deterministic
`wiring_check` gate that verifies it, with a diff-scoped orphan-export backstop.

## Diagram

```mermaid
graph TD
    subgraph DECIDE["DECIDE artifacts (authored per feature)"]
        ARCHREV["architecture-review SKILL<br/>MODIFIED: APPROVED output names<br/>production entry points / consumers<br/>(the wiring DECISION)"]
        PLAN["plan SKILL<br/>MODIFIED: derives per-task<br/>Wired-into: lines (the CONTRACT)<br/>Small tier: authors lines directly"]
        PLANDOC[(".docs/plans/«stem».md<br/>Wired-into: «file:symbol» lines<br/>or none (inert until «ref»)")]
    end

    subgraph ENGINE["Conductor engine (src/engine/)"]
        STEPS["steps.ts ALL_STEPS<br/>NEW step: wiring_check<br/>gating, loopGate, after build_review<br/>kickbackTarget: build"]
        PARSER["autoheal.ts<br/>NEW: WIRED_INTO_LINE parser<br/>beside FILES_LINE (#424 grammar precedent)"]
        PRED["artifacts.ts<br/>NEW: STEP_COMPLETION_CHECKS.wiring_check<br/>validates WiringEvidence<br/>(AcceptanceRedEvidence template)"]
        PROBE["NEW: wiring-probe.ts<br/>a) call-site verifier: declared site<br/>non-test-references new symbols<br/>b) orphan backstop: diff-scoped<br/>new exports reachable from entry points"]
        WAIVER["NEW: inert-waiver resolver<br/>none (inert until «ref») passes<br/>only with resolvable issue/spec ref"]
        VERDICT["gate-verdicts.ts — UNCHANGED<br/>GateVerdict kickback from build<br/>MAX_KICKBACKS_PER_GATE"]
        CTX["CompletionContext — MODIFIED<br/>injects wiring probe runner<br/>(push-evidence GitRunner template)"]
    end

    subgraph ENTRY["Production entry points (probe roots)"]
        E1["src/index.ts (CLI)"]
        E2["src/daemon-cli.ts"]
        E3["src/intake-loop-cli.ts"]
        E4["src/engine/engineer-cli.ts"]
    end

    GIT["git — feature diff base...HEAD<br/>new exported symbols"]

    ARCHREV -- "entry-point set (L/M tier)" --> PLAN
    PLAN --> PLANDOC
    PLANDOC -- "parsed contract" --> PARSER
    STEPS --> PRED
    PARSER --> PRED
    PRED --> PROBE
    PRED --> WAIVER
    CTX -- injected runner --> PROBE
    PROBE -- import graph roots --> ENTRY
    PROBE -- new-symbol set --> GIT
    PRED -- "satisfied / kickback + named gap" --> VERDICT
```

## Legend

- **NEW / MODIFIED** nodes are this feature; everything else exists today.
- The wiring **decision** is architectural: for M/L tiers, architecture-review's APPROVED
  output must enumerate the production entry points/consumers the feature hooks into.
  `/plan` derives the engine-parsed `Wired-into:` contract from it. **Small tier** (no
  architecture-review) falls back to plan-authored lines — the orphan backstop is the only
  net there.
- `wiring_check` is deterministic machinery (no LLM): it fails with a **named gap**
  (`«symbol» exported but unreachable from any entry point` / `declared call site
  «file:symbol» has no non-test reference`) and kicks back to build via the existing
  verdict plumbing. It never HALTs on the happy path; the stall cap
  (`MAX_KICKBACKS_PER_GATE`) provides the existing anti-ping-pong escalation.
- **INERT waiver:** `Wired-into: none (inert until «ref»)` passes only when `«ref»`
  resolves (issue/spec exists and is open work) — the follow-up wiring PR is never
  unenforced (closes the #179/#180 gap).
- Existing prompt-level guards are unchanged and complementary: architecture-review §12
  as-built reachability sweep (LLM judgment, catches unexercised-but-reachable),
  pipeline superseded-symbol grep, writing-system-tests real-entry-point rule.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-12 | Initial generation | DECIDE phase for issue #462 |
