# Component Diagram: Attribution Abstain-or-Loud Hardening (#519)

**Last updated:** 2026-07-11
**Scope:** Fixes the silent misattribution cascade in the #494 attribution machinery. In the
#492 build, `.pipeline/current-task` froze at task 1's id and every later commit (tasks 2–16)
was silently stamped `Task: 1`; the evidence gate then rejected 100% of finished work and the
build halted with retries exhausted. Root class (all code-verified): (1) `pre-dispatch.sh` has
four silent exit-0 paths that leave a STALE stamp in place when `task-status.json` is
unreadable, unparseable, wrong-shaped, or the atomic write fails; (2) `prepare-commit-msg`
falls back to guessing the id from the unique in_progress row when the stamp is absent;
(3) `commit-msg` validates trailer ids against `Object.keys` of the tasks ARRAY — array
indices, not real ids — so a stale-but-plausible id always passes (and the last task's id is
wrongly rejected; same defect line as #501). This feature converts every uncertainty into
abstain-or-loud: a stale stamp is impossible, a guess is impossible, and an invalid or missing
attribution fails loudly at commit time — the point of violation — not at end-of-build
evidence. Deliberately NOT parallel-native attribution (that is F4/#474 territory); the
overlap-guard clear-on-switch semantics are unchanged.

## Diagram

```mermaid
graph TD
    subgraph ASSETS["Engine asset templates (the only code that changes)"]
        SHA["session-hook-assets.ts<br/>PRE_DISPATCH_HOOK hardened"]
        GHA["git-hook-assets.ts<br/>prepare-commit-msg + commit-msg hardened"]
    end

    subgraph SHOOKS["Session hooks (installed per worktree)"]
        PRE["pre-dispatch.sh (PreToolUse)<br/>TODAY: status unreadable / unparseable / wrong shape /<br/>write-fail exit 0 silently, stamp left STALE<br/>HARDENED: every uncertainty path removes the stamp +<br/>loud stderr diagnostic — stale stamp impossible"]
        POST["post-dispatch.sh (PostToolUse)<br/>validated stamp removal (unchanged semantics,<br/>mismatch diagnostic kept loud)"]
    end

    subgraph STATE["Worktree .pipeline/ state"]
        CURR["current-task stamp<br/>INVARIANT: present means written by the<br/>most recent successful dispatch bookkeeping —<br/>never a leftover from an earlier task"]
        SEED["task-status.json<br/>engine-seeded rows = valid id set"]
    end

    subgraph GHOOKS["Git hooks (installed per worktree)"]
        PCM["prepare-commit-msg<br/>TODAY: stamp absent falls back to unique<br/>in_progress row — a silent guess<br/>HARDENED: stamp or abstain, never guess"]
        CMSG["commit-msg gate (#509 fail-closed)<br/>TODAY: validates trailer vs Object.keys of tasks ARRAY<br/>= indices 0..N-1 — stale id passes, last id rejected<br/>HARDENED: validates vs REAL task ids (fixes #501)"]
    end

    subgraph ENGINE["Engine gate (unchanged)"]
        DERIVE["deriveCompletion + path corroboration"]
    end

    SHA -->|"provisioned by worktree-prepare.ts"| SHOOKS
    GHA -->|"provisioned by worktree-prepare.ts"| GHOOKS
    PRE -->|"write on success, REMOVE on any uncertainty"| CURR
    PRE -->|"flip row in_progress"| SEED
    POST -->|"validated removal"| CURR
    CURR -->|"read: stamp trailer"| PCM
    PCM -->|"absent stamp: abstain, no trailer"| CMSG
    SEED -->|"REAL id set"| CMSG
    CMSG -->|"unattributed or invalid id: REJECT loudly<br/>agent fixes attribution at the moment of the mistake"| DERIVE
```

## Sequence: task N dispatch whose bookkeeping fails (the #519 shape)

```mermaid
sequenceDiagram
    participant ORCH as build orchestrator
    participant PRE as pre-dispatch hook
    participant ST as .pipeline state
    participant AGENT as task-N subagent
    participant PCM as prepare-commit-msg
    participant CMSG as commit-msg gate

    Note over ST: current-task still holds task 1 from an earlier dispatch
    ORCH->>PRE: dispatch (prompt line 1 Task: N)
    PRE->>ST: read task-status.json fails or shape invalid
    alt TODAY (silent cascade)
        PRE-->>ORCH: exit 0 quietly, stamp stays at task 1
        AGENT->>PCM: git commit
        PCM->>ST: reads stale stamp task 1
        PCM->>CMSG: trailer Task: 1 (plausible, wrong)
        CMSG-->>AGENT: PASSES (index check) — evidence poisoned
    else HARDENED (abstain-or-loud)
        PRE->>ST: REMOVE current-task stamp
        PRE-->>ORCH: stderr diagnostic names the failed path
        AGENT->>PCM: git commit
        PCM-->>PCM: stamp absent — abstain (no guess)
        PCM->>CMSG: no Task trailer
        CMSG-->>AGENT: REJECT loudly (build-step active, unattributed)
        AGENT->>CMSG: recommit with explicit Task: N trailer
        CMSG-->>AGENT: accepted — id validated against REAL ids
    end
```

## Legend

- **HARDENED** — behavior this feature changes; everything else (#452 state shapes, #494
  dispatch grammar and overlap guard, #509 marker semantics, the evidence gate) keeps its
  exact semantics.
- **Abstain-or-loud invariant** — the machinery may fail to attribute, but it may never
  attribute WRONGLY: uncertainty removes the stamp (abstain) and says so on stderr (loud);
  the gate then converts abstention into an instructive commit rejection the agent can fix
  immediately with a self-stamped, real-id-validated trailer.
- **Cascade breaker** — a stale-but-valid id (task 1) is indistinguishable from a correct
  trailer to every downstream check; the stamp file is therefore the only place the cascade
  can be broken. That is why the pre-dispatch uncertainty paths must remove it.
- **Out of scope** — parallel-native attribution (one global stamp cannot represent two
  in-flight tasks; live evidence in the #520 build). Filed separately (F4) as a prerequisite
  of #474. The overlap guard's clear-on-switch already degrades parallel dispatch to the
  abstain path, which this feature makes safe.
- **#501** — the real-id validation fix shares the defective code line with open issue #501
  (numeric-id rejection); this spec resolves both.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-11 | Initial generation | DECIDE phase for #519 (engineer worktree) |
