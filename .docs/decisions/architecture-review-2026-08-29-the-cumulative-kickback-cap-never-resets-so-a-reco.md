# Architecture Review: cumulative kickback budget recovery

**Date:** 2026-08-29
**Tier:** Medium (lightweight review)
**Input reviewed:** Approved PRD FR-1 through FR-14; approved architecture diagram; binding track
scope for jstoup111/ai-conductor#1760. Stories and plan do not yet exist.
**Verdict:** APPROVED

## Feasibility

The design is feasible in the current TypeScript/Node stack with no new package, service, database,
port, migration, or external account. It extends existing filesystem state, CLI dispatch, daemon
resume, and event infrastructure.

The original diagram's direct CLI halt deletion is not feasible as an atomic operation across the
budget ledger, external event ledger, halt pair, park state, and committed halt record. The reviewed
design replaces it with one leased staged decision in the kickback ledger and a daemon-owned resume
handoff. This is the only structural correction required.

Data compatibility is additive: legacy gate entries default to the current limit and empty
adjustment state. Worktree isolation is preserved because budget/control state and external events
remain feature-local; the only repo-root state is the existing exact-slug park marker.

## Alignment

- `adr-2026-08-12-cumulative-build-review-convergence-bound`: preserves count-based convergence and
  default cap 5; an explicit one-feature raise is the narrow partial supersession recorded in the
  new ADR.
- `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence`: preserves rebase-only
  automatic credit and the entry-wide lap rule; limit/history/authorization fields are explicitly
  non-lap-counting.
- `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane`: mechanical state remains separate
  and is never mutated by semantic recovery.
- `adr-2026-08-13-stable-build-review-finding-dispositions`: reuses named feature resolution,
  operator authority, external same-schema event writing, and exact-current-state refusal.
- `adr-2026-08-19-operator-step-rewind-through-the-mutation-port`: reuses compare-before-mutate,
  protective failure direction, and operator-only authority without copying its direct halt clear.
- `adr-2026-07-13-park-all-dispatch-paths`: temporary operator park is the quiescence boundary and
  remains authoritative at every dispatch entry.
- `adr-2026-08-23-committed-halt-record`: daemon-owned clear keeps committed halt resolution and
  event evidence consistent.

The approved architecture diagram is structurally accurate after the additive amendment below; no
container, external integration, database, or deployment boundary changes.

## Focused local pattern basis

- **Operator review commands:** `build-review-cli.ts` supplies named feature resolution, TTY and
  operator checks, exact-current-state refusal, and external event writing. Preserve those traits;
  parser names and output shape may vary for the new domain.
- **Cross-process serialization:** `conduct-state-lease.ts` supplies bounded exclusive ownership,
  stale-owner recovery, and fail-closed loss detection. Reuse the primitive with a ledger-specific
  label; do not invent a second lease algorithm.
- **Protected recovery:** `rewind.ts` demonstrates compare-before-mutate and protective halt
  restoration. Its direct halt deletion is not copied because committed halt resolution now belongs
  to daemon resume.
- **External events:** `build-review-dispositions` and the external event writer supply the
  same-schema sibling ledger, writer serialization, and merged-reader/tailer behavior.

BUILD should rediscover equivalent symbols on its current HEAD; these are semantic precedents, not
fixed line-number snapshots.

## Wiring Surface

| Production surface | Production wiring commitment |
|---|---|
| Root `kickback-budget` command family | Declared in `cli.ts`; detected and dispatched pre-boot from `index.ts` |
| Shared named-feature resolver | Called by both existing `build-review` operator commands and the new budget command; no duplicate path logic |
| Budget inspect/adjust service | Called only from the new CLI dispatcher; never from a step, provider, or autonomous conductor path |
| Leased kickback-ledger transaction API | Called by every existing engine ledger mutator plus the operator adjustment service |
| Pure cumulative budget view/renderer | Called by the cap-halt renderer and inspect human/JSON renderers |
| Typed cumulative-cap evidence and resume authorization | Written by the `build_review` cap branch; consumed only by the daemon halted-feature resume path |
| Adjustment authorization event | Declared in `ConductorEvent`/sink registry; produced by the external CLI writer; consumed by merged readers, live tail, daemon renderer, and audit trail |
| Temporary park ownership | Uses existing park/unpark primitives around the mutating command; pre-existing parks are preserved |
| Resume authorization consumer | Wired into the existing daemon re-kick/resume boundary before normal dispatch; clears only a matching `kickback-cap` halt |

> **Amended 2026-08-29 by #1760:** The resume consumer clears only a needs-human halt carrying exact
> matching typed cumulative-cap evidence, generation, and operator authorization. `kickback-cap` is
> a domain reason, not a new `HALT.class`. The consumer runs after operator-park/processed checks and
> before generic needs-human retention; missing or mismatched authority takes the existing retention
> branch.

Candidate implementation paths for overlap scanning:
`src/conductor/src/cli.ts`, `src/conductor/src/index.ts`,
`src/conductor/src/engine/build-review-cli.ts`,
`src/conductor/src/engine/kickback-ledger.ts`,
`src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/daemon-rekick.ts`,
`src/conductor/src/engine/daemon-cli.ts`, `src/conductor/src/engine/park-marker.ts`,
`src/conductor/src/engine/closeout-events.ts`, `src/conductor/src/types/events.ts`,
`src/conductor/src/engine/event-sinks.ts`, and `src/conductor/src/engine/audit-trail.ts`.

## Early Overlap Scan

The required advisory scan ran on 2026-08-29 with the candidate paths above, source reference
`jstoup111/ai-conductor#1760`, and base `main`. It reported 136 unmerged local or remote-tracking
`spec/*` refs that overlap at least one candidate path and reported no open dependency blocker.
The result is saturated by central integration files (`cli.ts`, `index.ts`, `conductor.ts`, event
types/sinks, and audit wiring), so it is coordination evidence rather than a reason to redesign the
feature.

The most directly related named overlaps include `spec/647-kickback-evidence-invalidation`,
`spec/651-park-all-dispatch-paths`, `spec/gate-kickback-counter-resets-every-dispatch-so-no-`,
`spec/one-build-review-pass-clears-the-convergence-cap-s`, and
`spec/unhalt-after-main-advance-resumes-against-stale-fe`. PLAN must preserve a rebase-first
implementation boundary, rediscover the live symbols on current HEAD, and avoid treating this
candidate path list as a frozen file manifest. The scanner's documented rename/name-only blind spot
also applies.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| Crash between external authorization event and ledger apply | Data | Low | High | Staged adjustment id; active values unchanged until idempotent event append is observed; command-entry reconciliation; park/halt retained |
| New dispatcher races the final write of a halting conductor | Integration | Low | High | Exact typed cap evidence, temporary park, shared ledger lease, compare-under-lease refusal |
| Recovery clears a different halt or resolves committed presentation incorrectly | Data | Low | High | Daemon consumes authorization only when slug, gate, class, generation, and live ledger agree; existing halt-clear lifecycle remains sole owner |
| Repeated operator raises weaken practical convergence | Technical | Medium | Medium | One exhausted halt and attributed rationale per raise; effective limit stays feature-local and visible |
| Legacy events cannot explain older individual laps | Knowledge | High | Low | Ledger values remain authoritative; inspection says historical detail unavailable rather than inventing it |
| Worktree deletion loses local adjustment history | Data | Low | Medium | Existing #497 fail-open limitation retained; no destructive recovery is introduced |

No production DI default, security boundary, provider integration, shared port, or database is added.

## ADRs Created

- `adr-2026-08-29-operator-authorized-kickback-budget-recovery` — superseded after conflict-check
  found its third halt class incompatible with the approved halt taxonomy.
  Structural prerequisite: new durable staged state transition and daemon/CLI ownership boundary.
  Governing-ADR reuse check found no existing decision that covers per-feature budget adjustment;
  the ADR explicitly extends the seven applicable approved decisions above.
- `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` — APPROVED on 2026-08-29.
  Preserves the staged recovery design while retaining `needs-human` and using typed ledger evidence
  as the exact cap identity.

## Conditions

None. The operator approved the ADR and corrected daemon-handoff sequence on 2026-08-29. The
architecture diagram's additive amendment controls BUILD; its earlier direct-clear arrows remain
historical context only.

## Blocking Issues

None.

## Plan Feasibility Amendment — 2026-08-29

The 19-task implementation plan is feasible against the approved architecture and introduces no new
architecture decision. Its dependency order establishes schema and leases before mutable behavior,
the event contract before external append, exact authority before reset/raise, reconciliation before
daemon resume, and completed command wiring before merged observability.

The plan-protected-target gate passed with no violations. The complete-path advisory overlap scan
reported 56 overlapping `spec/*` branch entries on central integration seams. BUILD must therefore
rebase first and rediscover live symbols, as already required by the early architecture scan; this
contention does not invalidate a component boundary or require a new ADR.

**Amendment verdict:** APPROVED — no conditions and no blocking issues.
