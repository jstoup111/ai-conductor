# Components + Sequences: Main-Checkout Leak Detection, Auto-Heal, and Write-Fence

**Last updated:** 2026-07-08
**Scope:** Where leak triage sits in the daemon's fast-forward path (`maybeFastForward` in
`daemon-backlog.ts`), the strict byte-identity gate that authorizes auto-heal, and the
prevention fence injected into build-session config via the sandbox settings provisioning
(`sandbox-build-env.ts`). Technical track — no PRD; issue jstoup111/ai-conductor#380.

## Component View

```mermaid
graph TD
  subgraph poll["daemon poll loop"]
    FF["maybeFastForward - default-branch tracking"]:::existing
    DIRTY["dirty-tree check - status porcelain"]:::existing
    LT["LeakTriage - classify dirty files vs candidate branch heads"]:::new
    HEAL["AutoHeal - git restore + stray removal, byte-identity gated"]:::new
    WARN["Leak WARN - names culprit branch, escalates instead of one-line skip"]:::new
  end

  subgraph build["build-session dispatch"]
    SB["sandbox-build-env - copied settings.json"]:::existing
    FP["FenceProvisioner - merges write-fence hook into sandbox settings"]:::new
    FH["write-fence PreToolUse hook - blocks Edit/Write outside worktree, flags Bash writes to main checkout"]:::new
    AGENT["build-step agent - cwd is the build worktree"]:::existing
  end

  BR["candidate branches - in-flight builds + recent feature heads"]:::existing

  FF --> DIRTY
  DIRTY -->|dirty| LT
  LT --> BR
  LT -->|all files byte-identical to one branch head| HEAL
  LT -->|any file differs| WARN
  HEAL --> WARN
  SB --> FP
  FP --> FH
  FH -.->|guards| AGENT

  classDef existing fill:#e8e8e8,stroke:#888,color:#333
  classDef new fill:#d4edda,stroke:#28a745,color:#155724
```

## Sequence: FF-skip leak triage + auto-heal

```mermaid
sequenceDiagram
  participant P as poll loop
  participant FF as maybeFastForward
  participant G as git (main checkout)
  participant LT as LeakTriage
  participant L as daemon log

  P->>FF: track origin/«default»
  FF->>G: status --porcelain
  G-->>FF: dirty (modified + untracked strays)
  FF->>LT: triage(dirty entries)
  LT->>G: hash working-tree files vs blobs at candidate branch heads
  alt every dirty file byte-identical to branch «feat» head
    LT->>G: git restore modified files
    LT->>G: remove strays whose content matches a «feat» blob
    LT->>L: WARN probable agent leak from build «feat» - healed, FF resumes
    FF->>G: fetch + merge --ff-only origin/«default»
  else any file differs from every candidate
    LT->>L: WARN loud escalation - operator changes possible, NOT healing
    FF-->>P: skip FF (unchanged behavior)
  end
```

## Sequence: fence provisioning at build dispatch

```mermaid
sequenceDiagram
  participant C as conductor (self-build)
  participant SB as provisionSandboxBuildEnv
  participant S as sandbox settings.json
  participant A as build-step agent
  participant H as write-fence hook

  C->>SB: provision(worktreeRoot, harnessRoot)
  SB->>S: copy operator settings + retarget harness paths
  SB->>S: merge write-fence PreToolUse entry (daemon-owned)
  C->>A: claude -p, cwd = worktree, CLAUDE_CONFIG_DIR = sandbox
  A->>H: Edit or Write with target path
  alt target inside build worktree (or allowed tmp)
    H-->>A: allow
  else target under registered main checkout
    H-->>A: block with guidance (exit 2)
  end
```

## Legend

- Green = new components for #380; grey = existing.
- **LeakTriage / AutoHeal**: heal is authorized ONLY by byte-identity of every dirty
  tracked file against a single candidate branch head; stray untracked files are removed
  only when their content matches a blob on that same branch. Anything else keeps the
  existing skip behavior but escalates the log signal.
- **FenceProvisioner**: phase 2; rides the existing settings-copy seam in
  `sandbox-build-env.ts`, so self-builds get the fence without touching the operator's
  global config. Bash-write guarding is heuristic (flag/deny paths referencing the
  registered main checkout) and must never false-block worktree-internal commands.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-08 | Initial generation | DECIDE for issue #380 (engineer loop) |
