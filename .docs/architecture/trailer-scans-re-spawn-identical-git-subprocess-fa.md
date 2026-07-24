# Architecture: trailer-scan memoization seam

Source issue: jstoup111/ai-conductor#878 · Track: technical · Tier: M

## Where the seam sits

The cache is introduced at exactly one place — inside `listCommitsWithTrailers`, on the
**no-anchor** branch only. Every consumer above it is unchanged and unaware.

```mermaid
flowchart TD
  subgraph consumers["Consumers (unchanged)"]
    A["conductor.ts<br/>countResolvedTasks<br/>(before/after attempt, watcher, evidence)"]
    B["artifacts.ts:1314<br/>resolveTaskIds<br/>(build exit predicate, #859)"]
    C["daemon-cli.ts:435<br/>countResolvedTasks per parked slug/sweep"]
    D["per-task-commit-floor.ts:37<br/>(#828)"]
  end

  A --> TP["task-progress.ts<br/>resolveTaskIds / countResolvedTasks<br/>(status-file read stays LIVE)"]
  B --> TP
  C --> TP
  TP --> LCT
  D --> LCT["autoheal.ts<br/>listCommitsWithTrailers(root, anchor?)"]

  LCT -->|"anchor given"| ER["getEvidenceRange<br/>merge-base --fork-point (reflog)<br/><b>NOT cached</b>"]
  LCT -->|"no anchor"| KEY["probe key (parallel):<br/>git rev-parse HEAD<br/>git merge-base ref HEAD"]

  KEY -->|"probe failed"| COLD2["fall through uncached<br/>(fail-soft preserved)"]
  KEY --> CACHE{"trailer-scan-cache<br/>key = (projectRoot, headSha, mergeBaseKey)"}
  CACHE -->|hit| COPY["return deep copy<br/>0 further subprocesses"]
  CACHE -->|miss| LOG["git log --format=…%(trailers)…<br/><b>the expensive fan</b>"]
  LOG --> STORE["store single entry for projectRoot"]
  STORE --> COPY

  KEY -.->|"needs origin ref"| MEMO{"originRef memo<br/>projectRoot → 'origin/&lt;default&gt;'<br/>positive results only"}
  MEMO -->|hit| KEY
  MEMO -->|miss| RES["resolveOriginRef:<br/>symbolic-ref origin/HEAD<br/>+ up to 2 rev-parse probes"]
  RES --> MEMO
```

## Subprocess accounting

| Path | symbolic-ref / probes | rev-parse HEAD | merge-base | git log | total |
| --- | --- | --- | --- | --- | --- |
| Today, every call | 1–3 | 0 | 1 | 1 | **3–5** |
| New, cold (first call per root) | 1–3 | 1 | 1 | 1 | 4–6 |
| New, warm + unchanged HEAD | 0 | 1 | 1 | 0 | **2** (issued in parallel ⇒ one latency round) |
| New, warm + HEAD moved | 0 | 1 | 1 | 1 | 3 |

The two warm-path calls are `git rev-parse` and `git merge-base` — pure ref plumbing,
issued concurrently via `Promise.all`. The eliminated `git log --format=…%(trailers)…`
is the dominant cost (it expands full commit messages for up to 100 commits).

**Deviation from the issue's stated observable.** #878 asks for "~1" subprocess on the
repeat. This design delivers **2**, deliberately: the third possible key —
`(headSha, defaultRefTipSha)`, obtainable in one `git rev-parse HEAD <ref>` — would
require assuming `merge-base` is a pure function of its two tip shas, which is false for
shallow clones (`--deepen` moves the graft boundary), `git replace` refs, and grafts.
Two cheap plumbing calls buy an unconditional freshness proof. The issue's own hard
constraint ("no staleness — a HEAD or merge-base change is always observed on the next
call") outranks its illustrative subprocess count. See the ADR.

## Cache lifetime and bounding

- **Scope:** module-level, per Node process. Not persisted, not shared across processes.
- **Shape:** `Map<projectRoot, { headSha, mergeBaseKey, commits }>` — **one entry per
  project root**, overwritten on change. It cannot grow with commit history.
- **Bound:** number of distinct project roots the process touches. In the daemon that is
  the slug worktree count; capped by a small LRU eviction (64) so a long-lived daemon
  that churns worktrees cannot leak.
- **Reset:** `resetTrailerScanCaches()` exported for tests and any future explicit
  invalidation need.

## Invariants the design must preserve

1. `countResolvedTasks` / `resolveTaskIds` return values are identical to pre-change for
   every input, including error inputs.
2. `.pipeline/task-status.json` is never cached — it is re-read on every call.
3. A cache entry is only ever written after a **successful** scan whose key was
   successfully probed.
4. No consumer receives an object graph another consumer can mutate.
