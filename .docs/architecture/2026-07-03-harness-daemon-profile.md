# Architecture: Harness Daemon Profile — build-to-PR enablement (#174)

**Last updated:** 2026-07-03
**Scope:** Completes daemon build-to-PR on the harness repo itself (issue #174): (1) a committed
`bin/setup` so daemon build worktrees get a working `src/conductor` toolchain, and (2) semver
escalation inside the existing `VersionApprovalGate` — PATCH-class change sets auto-pass (CI cuts
the patch on merge), MINOR/MAJOR signals or an undeterminable change set HALT for a human semver
decision. Extends `2026-06-30-harness-self-host-guardrails.md`; every invariant there
(HALT-based gates, daemon never merges — ADR-005/ADR-010) is preserved. New elements marked **[NEW]**.

## Diagram 1 — Components: where the two additions attach

```mermaid
flowchart TD
  daemon["daemon runner<br/>(daemon-deps.ts)"] --> createwt["createWorktree<br/>(worktree-shared.ts)"]
  createwt --> prep["prepareWorktree<br/>(worktree-prepare.ts)"]
  prep --> setup["[NEW] bin/setup (committed)<br/>npm install + npm run build<br/>in src/conductor"]
  setup --> build["sandboxed build steps<br/>(unchanged, guardrails bundle)"]

  build --> finishgates["runSelfHostFinishGates<br/>(conductor.ts)"]
  finishgates --> vg["VersionApprovalGate<br/>(version-gate.ts)"]
  vg --> cls{{"[NEW] SemverSignalClassifier<br/>classify change set vs base"}}
  cls -- "PATCH class" --> pass["auto-pass<br/>CI bumps patch on merge"]
  cls -- "MINOR signal<br/>new skill / hook / gate" --> halt["HALT<br/>.pipeline/HALT<br/>human semver decision"]
  cls -- "MAJOR signal<br/>breaking surface<br/>(classifyBreakingSurfaces)" --> halt
  cls -- "undeterminable<br/>fail-closed" --> halt
  marker[".pipeline/version-approval<br/>marker == VERSION"] -. "existing override:<br/>approved marker still passes" .-> vg
  pass --> rg["ReleaseArtifactGate<br/>(unchanged: integrity + CHANGELOG + migration)"]
  rg --> pr["finish: open PR only<br/>operator merges"]

  classDef new fill:#e6ffe6,stroke:#2a2;
  class setup,cls new;
```

## Diagram 2 — Sequence: self-build worktree prep + escalated version gate

```mermaid
sequenceDiagram
  autonumber
  participant D as Daemon runner
  participant P as prepareWorktree
  participant BS as bin/setup «NEW»
  participant B as Sandboxed build
  participant VG as VersionApprovalGate
  participant SC as SemverSignalClassifier «NEW»
  participant H as HALT marker
  participant O as Operator

  D->>P: worktree created for spec «slug»
  P->>BS: run bin/setup (CI=true, WORKTREE_NAMESPACE)
  BS->>BS: npm install + npm run build in src/conductor
  BS-->>P: exit 0 (non-zero keeps worktree, feature errored)
  P-->>D: worktree ready
  D->>B: dispatch build steps (relink + sandbox, unchanged)
  B->>VG: finish gates begin
  VG->>VG: approved marker present and equal to VERSION?
  alt marker approved
    VG-->>B: pass (existing behavior, unchanged)
  else no marker
    VG->>SC: classify change set vs base branch
    alt PATCH class only
      SC-->>VG: auto-pass, CI cuts patch on merge
    else MINOR or MAJOR signal, or undeterminable
      SC->>H: HALT naming the signal and the files that raised it
      O-->>VG: sets VERSION or writes version-approval, clears HALT
    end
  end
  VG->>B: continue to ReleaseArtifactGate then open PR
  Note over O: operator reviews and merges — daemon never merges
```

## Legend

- **[NEW] / «NEW»** — elements introduced by this feature (green fill in Diagram 1).
- **bin/setup** — the repo's conventional post-worktree-creation hook, already invoked by
  `prepareWorktree` for every daemon worktree when present; this feature commits one for the
  harness repo itself. Non-zero exit throws: the worktree is kept and the feature marked errored.
- **SemverSignalClassifier** — pure function over the build branch's change set vs its base.
  MAJOR reuses the existing `classifyBreakingSurfaces` surfaces (bin/conduct, bin/install,
  hooks/, settings schema, removed/renamed skills); MINOR detects additive skill/hook/gate
  surface (new `skills/*/SKILL.md`, new hook file, new gate registration); anything it cannot
  classify is treated as HALT-worthy (fail-closed). It never edits `VERSION` — the human does.
- **Existing marker override** — `.pipeline/version-approval` matching `VERSION` still passes the
  gate unconditionally, so the operator's manual approval path is unchanged.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-03 | Initial generation | Created during /engineer DECIDE for harness-daemon-profile (#174, Tier M) |
