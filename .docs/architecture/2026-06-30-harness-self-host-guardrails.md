# Architecture: Harness Daemon Self-Host Guardrails

**Last updated:** 2026-06-30
**Scope:** The **build-plane** guardrails that make the `james-stoup-agents` harness repo safe
to daemon-register — a unified **harness self-host mode** activated by a self-detect seam. Shows
the new components and how they attach to existing conductor seams (preflight, build step, finish
step, config, HALT). Complements `2026-06-29-daemon-supervised-hosting.md` (the management plane)
and preserves its ADR-005 (automation is launch-only) / ADR-010 (single-owner) invariants: every
new gate is **HALT-based**, so the operator — never the daemon — merges. New elements marked **[NEW]**.

## Diagram 1 — Components: self-host mode attached to conductor seams

```mermaid
flowchart TD
  daemon["runDaemon / discoverBacklog<br/>(daemon.ts)"] --> detect
  detect{{"[NEW] SelfHostDetector<br/>repo == harnessRoot?<br/>auto-detect · config override"}}
  detect -- "not harness" --> normal["normal build path<br/>(unchanged)"]
  detect -- "harness self-build" --> mode["[NEW] Harness self-host mode<br/>guardrail bundle"]

  subgraph pre["Pre-dispatch"]
    relink["[NEW] SkillRelinkPreflight<br/>extends ensureInstallFresh<br/>(install-freshness.ts)"]
  end
  subgraph buildplane["Build plane"]
    sandbox["[NEW] SandboxBuildEnv<br/>throwaway CLAUDE_CONFIG_DIR<br/>skills+hooks point to worktree"]
    buildstep["build step<br/>(steps.ts · DefaultStepRunner)"]
  end
  subgraph finishplane["Finish plane"]
    versiongate["[NEW] VersionApprovalGate"]
    releasegate["[NEW] ReleaseArtifactGate<br/>integrity + CHANGELOG + migration"]
    finishstep["finish step<br/>(conductor.ts · artifacts.ts predicate)"]
  end

  mode --> relink --> sandbox --> buildstep --> versiongate --> releasegate --> finishstep
  versiongate -- "no approval marker" --> halt["writeHalt to .pipeline/HALT<br/>(rebase.ts)"]
  releasegate -- "integrity/changelog fail" --> halt
  finishstep -- "harness self-build" --> halt

  config["HarnessConfig + validateConfig<br/>(types/config.ts)"] -. "activation override + gate cfg" .-> detect
  integrity["test_harness_integrity.sh"] -. "invoked by" .-> releasegate
  install["bin/install skill symlinks"] -. "relink target" .-> relink

  classDef new fill:#e6ffe6,stroke:#2a2;
  class detect,mode,relink,sandbox,versiongate,releasegate new;
```

## Diagram 2 — Sequence: harness self-build with sandbox + preflight

```mermaid
sequenceDiagram
  autonumber
  participant D as Daemon runDaemon
  participant P as SkillRelinkPreflight
  participant W as Worktree build
  participant S as SandboxBuildEnv
  participant CC as Claude Code build
  participant H as HALT marker

  D->>D: discoverBacklog finds merged spec for «slug»
  D->>P: ensureInstallFresh relinks skills
  P-->>D: skills linked, no unlinked-skill HALT
  D->>W: create .worktrees/«slug» and dispatch build
  W->>S: build step detects harness self-build
  S->>S: create throwaway CLAUDE_CONFIG_DIR
  S->>S: link sandbox skills+hooks to worktree edits
  S->>CC: run build with CLAUDE_CONFIG_DIR set to sandbox
  Note over CC: exercises the EDITED harness,<br/>not global ~/.claude
  CC-->>S: acceptance + unit tests green vs real edits
  S->>S: teardown sandbox, global symlinks untouched
  W->>H: HALT for manual re-install, verify, merge
  Note over H: operator never merges autonomously
```

## Diagram 3 — Sequence: finish-time release gates (HALT-based)

```mermaid
sequenceDiagram
  autonumber
  participant F as Finish step
  participant VG as VersionApprovalGate
  participant RG as ReleaseArtifactGate
  participant IT as integrity suite
  participant H as HALT marker
  participant O as Operator

  F->>VG: check VERSION bump before PR
  alt no approved-version marker
    VG->>H: HALT to request VERSION-bump approval
    O-->>VG: records approval, resumes build
  end
  VG->>RG: version approved
  RG->>IT: run test_harness_integrity.sh
  IT-->>RG: exit code
  RG->>RG: assert CHANGELOG [Unreleased] non-empty
  RG->>RG: assert migration block when breaking
  alt any release gate fails
    RG->>H: HALT naming the failing gate
  end
  RG->>F: all release gates pass
  F->>H: HALT to re-install, run verify, then merge
  O-->>F: manual merge, never autonomous
```

## Legend

- **[NEW]** — components introduced by this feature (green fill in Diagram 1).
- **HALT** — `writeHalt()` writing `.pipeline/HALT`; the canonical "park for a human" primitive.
  In daemon `auto` mode there is no human to prompt, so every guardrail that cannot self-satisfy
  HALTs rather than proceeding.
- **SelfHostDetector** — resolves whether the repo under build IS the harness (via the existing
  `resolveHarnessRoot()`); a swappable seam so platform identity (isolated EKS) can replace path
  comparison later.
- **SandboxBuildEnv** — a throwaway `CLAUDE_CONFIG_DIR` whose skills/hooks symlink into the build
  worktree, so a harness self-build executes its own edited harness; the global `~/.claude/skills`
  used by the operator's concurrent sessions is never mutated.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-06-30 | Initial generation | Created during /engineer DECIDE for harness self-host guardrails (Tier L) |
| 2026-07-03 | VersionApprovalGate "no approval marker → HALT" is refined by semver escalation (PATCH auto-pass) | harness-daemon-profile #174 — see 2026-07-03-harness-daemon-profile.md |
