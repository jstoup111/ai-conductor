# Architecture — Shipped PRs get a re-examined readiness verdict

**Stem:** `shipped-is-fire-and-forget-no-reconciliation-sweep` · Tier M (lightweight) · 2026-10-09 · Refs #438

**Last updated:** 2026-10-09
**Scope:** the daemon's per-tick mergeable sweep over **daemon-shipped, watched PRs only**
(`.daemon/mergeable-watch.jsonl` entries enrolled by `daemon-runner.ts` on ship). Spec PRs,
manual/unledgered PRs, and any operator digest of them are out of scope.

Today `sweepMergeableLabels` (`mergeable-sweep.ts`) reads each watched PR once and runs a chain
of independent `if`s: prune MERGED/CLOSED, skip read failures, reconcile the `mergeable` label,
collect `mergeable === 'CONFLICTING'` (non-draft) for autoresolve, collect `checksOutcome ===
'failed'` for ci-fix. Three states fall through every branch: lazy `UNKNOWN` mergeability
(GitHub computes it on demand — a second read resolves it), a head SHA with **zero** check runs
(`checksOutcome: 'none'` is treated as no evidence), and a shipped PR that drifted back to
**draft** after finish marked it ready.

The change: after the existing MERGED/CLOSED/NOTFOUND lifecycle handling, each **live** watched
PR gets exactly one **readiness verdict** from a pure classifier, and each verdict has exactly
one route. The route table is an exhaustive `switch` over a closed union, so adding a verdict
without a route is a compile error. Every verdict is emitted on the existing event spine; the
status renderer reads the latest verdict per PR from `.daemon/events.jsonl` (same pattern as the
READ-ONLY REVIEW CAPABILITY section).

## Component / dataflow (C4 component level)

```mermaid
flowchart TD
  TICK["daemon.ts idle poll tick"] --> SWEEP["sweepMergeableLabels<br/>(mergeable-sweep.ts)"]
  WATCH[".daemon/mergeable-watch.jsonl<br/>(enrolled on ship by daemon-runner)"] --> SWEEP

  subgraph READ["State read (pr-labels.ts / tracker-client.ts)"]
    R1["readPullRequestMergeState<br/>+ NEW: mergeStateStatus, head-SHA check count"]
    R2["NEW: bounded re-read when<br/>mergeable = UNKNOWN"]
  end
  SWEEP --> R1
  R1 -- "UNKNOWN" --> R2

  LIFE["existing lifecycle branch<br/>MERGED / CLOSED → shipped-record gate<br/>NOTFOUND → prune · read failure → skip"]
  R1 -- "not OPEN" --> LIFE

  CLS["NEW: classifyShippedReadiness(state)<br/>pure · closed union<br/>ready | conflicting | ci-failing | ci-pending |<br/>no-checks | draft | indeterminate"]
  R1 -- "OPEN" --> CLS
  R2 --> CLS

  subgraph ROUTE["NEW: exhaustive route table (one route per verdict)"]
    RT_READY["ready → mergeable label reconcile (existing)"]
    RT_CONF["conflicting (CONFLICTING or DIRTY) →<br/>autoresolve candidate (existing dispatch)"]
    RT_CI["ci-failing → ci-fix candidate (existing dispatch)"]
    RT_NC["no-checks (base main, grace elapsed) →<br/>needs-remediation, self-clearing<br/>(existing label path)"]
    RT_DR["draft → needs-remediation, self-clearing<br/>(existing label path)"]
    RT_IND["indeterminate (still UNKNOWN) / ci-pending →<br/>wait; re-examined next tick"]
  end
  CLS --> RT_READY & RT_CONF & RT_CI & RT_NC & RT_DR & RT_IND

  RT_CONF --> AR["autoresolve.ts"]
  RT_CI --> CF["ci-fix.ts"]
  RT_NC --> GH["GitHub (guarded operation runner)"]
  RT_DR --> GH
  RT_READY --> GH

  CLS -- "onEvent: shipped_pr_readiness<br/>(NEW wiring in daemon-cli)" --> SPINE["daemon ConductorEventEmitter →<br/>.daemon/events.jsonl"]
  SPINE --> STATUS["daemon status (daemon-observe-cli.ts)<br/>NEW: SHIPPED PRS section — non-ready only"]
  CLS -. "head SHA + first-seen (grace)" .-> WATCH
```

## Sequence — one tick for a zero-check, lazily-UNKNOWN shipped PR

```mermaid
sequenceDiagram
  participant D as daemon tick
  participant S as mergeable sweep
  participant G as GitHub
  participant C as readiness classifier
  participant E as event spine
  D->>S: sweepMergeableLabels
  S->>G: read PR state (mergeable, mergeStateStatus, checks, isDraft, base, head SHA)
  G-->>S: OPEN, mergeable UNKNOWN, 0 check runs
  S->>G: one re-read (mergeability)
  G-->>S: MERGEABLE / CLEAN, 0 check runs
  S->>S: record head SHA first-seen in watch entry (if new)
  S->>C: classify(state, grace elapsed?)
  alt grace not elapsed or base is not main
    C-->>S: ci-pending (wait, no mutation)
  else base main and grace elapsed
    C-->>S: no-checks
    S->>G: add needs-remediation label (once, absent to present)
  end
  S->>E: shipped_pr_readiness (only when verdict changed for this head SHA)
  Note over D,E: daemon status lists the PR under SHIPPED PRS until a later verdict is ready
```

## Legend

- **NEW** marks components this feature adds; everything else exists on main today.
- `conflicting` covers `mergeable = CONFLICTING` **or** `mergeStateStatus = DIRTY`.
- `indeterminate` and `ci-pending` are the only verdicts whose route performs no action; it is re-examined on the
  next tick, never silently dropped (it is still emitted and still shown in status).
- **Self-clearing:** a `needs-remediation` label the sweep added for `no-checks`/`draft` (recorded as
  `escalationCause: shipped-readiness`) is removed once the verdict is none of `no-checks`,
  `draft`, `ci-pending`, `indeterminate`; labels
  from any other source stay sticky.
- Existing draft exclusion for autoresolve/ci-fix dispatch is preserved: a `draft` verdict routes
  only to the needs-remediation signal.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-09 | Initial generation | Spec for #438 (Approach B, operator-confirmed scope: daemon-shipped PRs) |
| 2026-10-09 | no-checks routes to needs-remediation (no CI nudge); added ci-pending; sweep onEvent wired to daemon emitter | Operator chose surface-only nudge; review found sweep events unwired |
| 2026-10-09 | Readiness label is self-clearing (escalationCause shipped-readiness) | Conflict-check: sticky label barred recovered PRs from mergeable and ci-fix |
| 2026-10-09 | Plan update: readiness label held through ci-pending; status restricted to watched PRs | /plan independent judgements |
