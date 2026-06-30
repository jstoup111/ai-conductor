# Architecture: Daemon PR Labeling

**Last updated:** 2026-06-29
**Scope:** The two daemon-mode PR-labeling behaviors (`needs-remediation`, `mergeable`), the new
shared gh PR-ops module, the mergeable watch registry + sweep, and how they attach to existing
conductor/daemon pieces (HALT path, halt-reconciliation, `/finish` PR creation). Spec:
`.docs/specs/2026-06-29-daemon-pr-labels.md` (FR-1…FR-16).

## Component view (L3)

```mermaid
flowchart TD
  subgraph SGENGINE["conduct-ts engine"]
    CR["Conductor.run auto-mode<br/>build-failure block"]
    DR["daemon-runner.ts<br/>feature-outcome handling"]
    DLOOP["daemon.ts startup<br/>reconcile + poll loop"]
    HALT["HALT path<br/>.pipeline/HALT + halt-reconciliation"]
    FIN["finish step<br/>creates or reuses PR, sets pr_url"]
  end

  subgraph SGNEW["new modules this feature"]
    ESC["build-failure-escalation.ts<br/>FR-1..FR-8"]
    SWEEP["mergeable-sweep.ts<br/>FR-9..FR-15"]
    CLEAR["clear-on-success<br/>FR-16"]
    PROPS["pr-labels.ts shared gh seam<br/>ensureLabel, add, remove,<br/>prMergeState, findOrCreatePr,<br/>comment, setReady"]
    WATCH["mergeable-watch.jsonl<br/>per-repo tracking registry"]
  end

  GH["GitHub via gh CLI"]

  CR -->|"build failed irrecoverably, auto"| ESC
  CR -.->|"writes HALT first, unchanged"| HALT
  ESC -->|"push, draft PR, comment, label"| PROPS

  DR -->|"outcome done with pr_url"| CLEAR
  DR -->|"enroll done PR"| WATCH
  CLEAR -->|"remove needs-remediation, gh pr ready"| PROPS
  DLOOP -->|"startup, per-feature, per-tick"| SWEEP
  SWEEP -->|"read watch list"| WATCH
  SWEEP -->|"prMergeState, add or remove mergeable, prune"| PROPS

  FIN -->|"PR url reused on same branch"| PROPS
  HALT -.->|"re-kick on base advance, build may succeed"| DR

  PROPS -->|"gh pr create, view, edit, comment, ready; gh label create"| GH

  classDef newcls fill:#e8f5e9,stroke:#2e7d32;
  classDef store fill:#fff3e0,stroke:#e65100;
  class ESC,SWEEP,CLEAR,PROPS newcls;
  class WATCH store;
```

### Legend
- **Green** = new modules added by this feature. **Orange node** = new persisted state.
- Solid arrows = direct calls / data flow. Dashed arrows = existing/indirect relationships.
- All `new` → `GitHub` edges are **best-effort**: every `pr-labels.ts` primitive is internally
  try/caught and non-throwing (FR-7, FR-15), so a gh failure never propagates back into the
  conductor/daemon control flow.
- `pr-labels.ts` is the single seam over `gh`; both behaviors and clear-on-success go through it,
  so GitHub interaction is testable with injected fake runners.

## Sequence: needs-remediation surfacing (FR-1..FR-8)

```mermaid
sequenceDiagram
  participant CR as Conductor.run auto
  participant HALT as .pipeline/HALT
  participant ESC as build-failure-escalation
  participant PR as pr-labels gh seam
  participant GH as GitHub

  CR->>CR: build step retries exhausted
  CR->>HALT: write HALT and state first, unchanged
  CR->>ESC: escalateBuildFailure when step is build and mode is auto
  ESC->>ESC: derive branch and base, count commits
  alt zero commits, FR-6
    ESC-->>CR: return, no GitHub surface
  else commits exist, FR-2
    ESC->>PR: git push branch
    alt push fails, FR-7
      PR-->>ESC: error logged and swallowed
      ESC-->>CR: return, run still parks
    else pushed
      ESC->>PR: findOrCreatePr draft, FR-4 FR-5
      PR->>GH: gh pr view or create draft
      ESC->>PR: ensureLabel and addLabel needs-remediation, FR-2
      ESC->>PR: comment reason and error, FR-3 priority artifact
      Note over ESC,PR: each step independently swallowed
      ESC-->>CR: return prUrl
    end
  end
  CR->>CR: emit loop_halt, return cleanly
```

## Sequence: done-outcome → clear-on-success + mergeable sweep (FR-9..FR-16)

```mermaid
sequenceDiagram
  participant DR as daemon-runner outcome done
  participant CLEAR as clear-on-success
  participant WATCH as mergeable-watch.jsonl
  participant SWEEP as mergeable-sweep
  participant PR as pr-labels gh seam
  participant GH as GitHub

  DR->>DR: feature outcome done with pr_url, FR-9
  DR->>CLEAR: if PR carries needs-remediation, FR-16
  CLEAR->>PR: removeLabel needs-remediation and gh pr ready, best-effort
  DR->>WATCH: enroll prUrl, slug, repoCwd
  DR->>DR: teardown worktree, mark processed

  loop startup, after each feature, per poll tick, FR-14
    SWEEP->>WATCH: read tracked PRs
    SWEEP->>PR: prMergeState returns state, mergeable, checks, labels
    PR->>GH: gh pr view json state mergeable statusCheckRollup labels
    alt MERGED or CLOSED or 404, FR-13
      SWEEP->>WATCH: prune entry
    else carries needs-remediation, FR-12
      SWEEP->>PR: ensure mergeable absent
    else open, no conflicts, checks green, FR-10
      SWEEP->>PR: ensureLabel and addLabel mergeable
    else not mergeable or UNKNOWN, FR-11
      SWEEP->>PR: removeLabel mergeable if present
    end
  end
```

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-06-29 | Initial generation | New feature: daemon PR labeling (needs-remediation + mergeable, FR-1…FR-16) |

## Notes for architecture-review
- `pr-labels.ts` is the **only** new code that talks to `gh`; the three behaviors compose it. This
  isolates the external boundary (single mock point, single retry/swallow policy).
- The watch registry is **per-repo** (`.daemon/`-adjacent), self-pruning, and stateless to
  reconstruct (the sweep re-derives label truth from GitHub each pass), so a lost/corrupt registry
  degrades to "no labels" rather than wrong labels.
- No new container, DB table, or external system — only a new file-backed registry and a new CLI
  boundary usage (`gh`). System-context/containers diagrams unchanged.
