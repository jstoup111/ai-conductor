# Components: Phase-Scoped .docs Write-Guard (#788)

**Last updated:** 2026-07-22
**Scope:** The new spec-artifact write-guard that mechanically blocks BUILD/SHIP-phase
session edits under `.docs/` — (1) a phase-keyed marker written by the conductor around
every BUILD/SHIP step, (2) a typed engine-side allowlist table resolved into the marker,
and (3) a new `docs-guard.sh` PreToolUse hook on the write surface — shown against the
existing, untouched attribution seam (`build-step-active` + MUTATION_GATE_HOOK) and the
engine-side `.docs` writers that bypass the guard by design.

## Diagram

```mermaid
graph TD
    subgraph Engine["Engine - conductor step dispatch"]
        STEPS[("steps.ts<br/>per-step phase field<br/>BUILD or SHIP")]
        DISP["Step dispatch loop<br/>conductor.ts"]
        TABLE[("NEW two-part allowlist table<br/>per-step: retro to .docs/retros/, .docs/stories/<br/>always-allowed in BUILD/SHIP: .docs/release-waivers/")]
        REM["appendRemediationTasks<br/>engine-side plan append<br/>conductor.ts:1205"]
    end

    subgraph Markers["Worktree .pipeline/ markers - gitignored"]
        PA[("NEW .pipeline/phase-active<br/>step name + phase +<br/>resolved allowed prefixes<br/>written on BUILD/SHIP entry,<br/>cleared on step exit")]
        BSA[(".pipeline/build-step-active<br/>attribution marker - build step only<br/>UNTOUCHED")]
    end

    subgraph Session["Claude session - PreToolUse chain on Edit-Write-NotebookEdit"]
        MUT["mutation-gate.sh<br/>attribution stamp gate<br/>UNTOUCHED"]
        DG["NEW docs-guard.sh<br/>marker absent: exit 0 pass<br/>marker present + .docs/ target:<br/>prefix-allowed: pass<br/>else exit 2 with reason"]
        AG["Session agent<br/>build or ship skill"]
    end

    subgraph Wiring["Hook wiring surfaces"]
        WTP["worktree-prepare.ts<br/>daemon worktrees<br/>settings.local.json"]
        BOOT["NEW bootstrap wiring<br/>primary checkout settings<br/>+ CHANGELOG migration block"]
    end

    subgraph Bypass["Engine-side .docs writers - bypass by design"]
        SR["shipped-record CLI<br/>.docs/shipped/ via Bash"]
    end

    DOCS[(".docs/ spec artifacts<br/>plans, stories, specs, ADRs<br/>the guarded contract")]

    STEPS -->|"phase of entering step<br/>is BUILD or SHIP"| DISP
    DISP -->|"resolve step name<br/>against table"| TABLE
    DISP -->|"write marker with<br/>resolved prefixes"| PA
    DISP -.->|"clear on step exit<br/>stale marker handled"| PA
    DISP -->|"build step only<br/>existing behavior"| BSA

    AG -->|"Edit or Write attempt"| MUT
    MUT --> DG
    PA --> DG
    DG -->|"pass"| DOCS
    DG -.->|"exit 2: spec artifacts frozen<br/>during «phase» - clear reason"| AG

    WTP -->|"writes + wires<br/>docs-guard.sh"| DG
    BOOT -->|"wires same hook<br/>inert without marker"| DG

    REM -->|"node process write<br/>not a tool call"| DOCS
    SR -->|"Bash CLI write<br/>outside write surface"| DOCS
```

## Legend

- **NEW** — the four surfaces this feature adds: the `phase-active` marker, the
  allowlist table, `docs-guard.sh`, and bootstrap wiring. Every other node exists today.
- **Orthogonality** — `build-step-active` (attribution stamps) and `phase-active`
  (spec freeze) are separate markers with single meanings; `docs-guard.sh` runs as a
  sibling of `mutation-gate.sh` in the same PreToolUse chain, and neither reads the
  other's marker.
- **Phase-keyed, not name-keyed** — the marker is written for any step whose
  `steps.ts` phase is BUILD or SHIP, so future steps added to either phase inherit the
  guard automatically (the attribution marker's `step.name === 'build'` guard is the
  counterexample this avoids).
- **Default-deny inside `.docs/`** — the hook blocks any `.docs/` prefix not explicitly
  allowed by the marker's resolved list; new `.docs/` subdirectories are protected
  without code changes.
- **Bypass by design** — engine-process writers (`appendRemediationTasks`) and
  Bash-mediated CLI writers (`shipped-record`) are outside the PreToolUse write surface;
  this is the operator-accepted scope (write-surface only).
- `«…»` — placeholder for a variable value.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-22 | Initial generation | DECIDE phase for #788 (engineer spec authoring) |
| 2026-07-22 | Allowlist node updated to two-part model (always-allowed .docs/release-waivers/) | Conflict-check resolution (release-waiver authoring during BUILD) |
