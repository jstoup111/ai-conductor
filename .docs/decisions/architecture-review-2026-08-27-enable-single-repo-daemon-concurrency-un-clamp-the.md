# Architecture Review: Enable single-repo daemon concurrency (dispatcher/executor seam + un-clamp)
**Date:** 2026-08-27
**Stories reviewed:** none yet — pre-stories full pass (tier L, technical track); inputs were the explore output, the operator-approved diagrams, and issue jstoup111/ai-conductor#568
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack compatibility:** pure TypeScript refactor of the existing daemon core; no new
  dependencies, services, or infrastructure. The pool is already N-capable
  (`daemon.ts` fill loop / `Promise.race` collection); the clamp is one function
  (`daemon-command.ts` `clampDaemonConcurrency`). Verified in source, 2026-08-27.
- **Prerequisites:** none open. Of #568's original blockers, #549/#486/#534 are closed;
  #564's remaining scope (cwd-ambiguity point fixes) is not amplified by in-process
  concurrency because each executor's cwd is its own worktree. Confidence: high
  (verified against issue states and code).
- **Integration surface:** wide but internal — the run loop, backlog discovery,
  worktree lifecycle, config resolution, live boundary, event/log attribution. No
  external API changes. The seam formalizes boundaries that mostly exist already
  (per-slug worktrees, per-worktree DB namespaces, per-feature scoped event buses,
  per-run provider scratch leases).
- **Data implications:** none durable. The in-memory claim registry replaces in-memory
  sets; no schema, no migration. The pinned base SHA travels in the work order and the
  existing setup marker.
- **Performance risk:** N>1 multiplies `gh` calls and the per-dispatch
  `discoverNodeModules` walk; both bounded by existing once-per-pass hoists
  (adr-2026-08-08 D2) and acceptable at the N=2–3 this targets. Risk register entry R6.
- **Worktree isolation:** the substrate is already parallel-ready — per-slug worktree +
  branch, `WORKTREE_NAMESPACE` DB isolation, per-slug processed/parked markers,
  per-worktree `.pipeline/events.jsonl`. The genuinely shared surfaces (root checkout,
  root `.daemon/` singletons, the one `.git`) move behind dispatcher ownership (ADR D1).

## Complexity

High (tier L confirmed): one core refactor with a behavioral-equivalence constraint at
concurrency 1, plus four interacting state machines (claim lifecycle, fill/drain,
maintenance policies, live-boundary windows). Not a split candidate: the seam and the
un-clamp are one coherent structural change, and the operator explicitly chose combining
them over a seam-only feature. Spike not needed — every load-bearing mechanism was
verified in source during discovery.

## Alignment

Full repo-wide ADR sweep performed (294 ADRs read; delegated full pass, not
keyword-filtered). Findings:

- **Amended by this design** (each gets an additive amendment note pointing at the new
  ADR): `adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting` D4 (the clamp),
  `adr-2026-07-03-daemon-auto-restart-stale-engine` D2,
  `adr-2026-07-22-origin-refresh-before-engine-rebuild` invariant 1,
  `adr-2026-07-04-pending-restart-queue`, `adr-2026-07-04-respawn-in-place-restart`,
  `adr-2026-07-07-single-generation-stale-respawn` D2,
  `adr-2026-07-03-harness-daemon-profile` (go-live boundary wording),
  `adr-2026-08-26-setup-once-per-worktree-marker` D2 (base-equality predicate becomes
  pin-aware).
- **Preserved, binding on BUILD:** single dispatch authority
  (`adr-2026-07-04-event-driven-halt-clear-wake` D3) — WorkClaims formalizes, never
  duplicates, the `started`/`inFlight`/`parked` authority; all dispatch funnels through
  the one park-guarded primitive (`adr-2026-07-13-park-all-dispatch-paths`, entry-point
  enumeration test extends to the dispatcher claim path); ADR-010 pidfile lock unchanged
  (one process); no heartbeat/lease (`adr-2026-07-22-heartbeat-lease-deferred`);
  conduct-state writes stay behind the mutation port
  (`adr-2026-08-01-conduct-state-mutation-port`); reap-gate explicit fetch
  (`adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main` D3); no
  live-boundary exclusion widening (`adr-2026-08-17-structural-live-checkout-containment`
  D4); event-sink registry exhaustiveness for any new event types
  (`adr-2026-07-26-event-sink-registry-exhaustiveness`); central-stamp attribution
  (`adr-2026-08-11-halt-events-ride-the-persisted-spine` precedent); config-key consumer
  registry (`adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal` D4);
  per-executor OTel visualizer on the feature-scoped bus (adr-014 as amended, standing
  conditions C1/C2 of `architecture-review-2026-08-26-daemon-dispatched-builds…`).
- **Fresh-base family reconciliation** (the sweep's riskiest finding): pinning is
  compatible because local fetch/fast-forward never moves the remote, merge-base-relative
  predicates are fork-point-stable under tracking-ref advance, and the two tip-equality
  consumers are explicitly redefined in ADR D4. `build_review`'s freshest-base semantics
  (`adr-2026-07-23-build-review-fresh-base-disposition`) are untouched — its base-advance
  exposure comes from remote merges, which happen with or without this change.
- **Pattern basis:** `validation_concurrency`
  (`adr-2026-07-10-concurrent-group-core` D1) is the local precedent for the new config
  key — typed key, allow-list entry, `resolve*` clamp helper, consumer-registry row;
  rediscovery seeds: `src/conductor/src/types/config.ts` (`validation_concurrency`),
  `src/conductor/src/engine/config.ts` (allow-list + validation),
  `resolved-config.ts` (`resolveValidationConcurrency`). Variation allowed: name and
  default; not allowed: skipping registry/validation.
- **Diagram accuracy:** feature diagrams approved by the operator 2026-08-27
  (`.docs/architecture/enable-single-repo-daemon-concurrency-un-clamp-the.md`, sequence
  of the same stem).

## Domain Integrity

- The work order is a semantic type (WorkOrder), not loose parameters; the manifest
  entries carry ref + content hash, not bare strings pasted around.
- Claim states are an explicit lifecycle behind the interface, not boolean flags spread
  across sets — but the interface deliberately mirrors today's set semantics (D3) so no
  second authority exists.
- Maintenance policies are declared per operation, not inferred from a shared counter;
  invalid states ("restart while executor running") become unrepresentable at the
  scheduler seam rather than prevented by a guard expression.
- No primitive-obsession or parse-twice findings; no production `InMemory*` default
  concern applies — the in-memory claim registry is correct-by-design for a
  single-process authority (restart deliberately clears claims; the backlog re-derives
  work from durable git/ledger state, so nothing user-visible is lost on restart).

## Wiring Surface (design-time)

| New surface | Called from (production) |
|---|---|
| `WorkClaims` (interface + in-memory impl) | `pickEligible`/dispatch path in `engine/daemon.ts`'s run loop |
| `WorkOrder` builder + document manifest resolution | dispatch site in `engine/daemon.ts` → `deps.runFeature` wiring in `daemon-cli.ts`/`daemon-deps.ts` |
| `FeatureExecutor` (in-process v1) | the pool's dispatch slot in `engine/daemon.ts`, wrapping today's `runConductorInWorktree` path in `daemon-cli.ts` |
| Maintenance scheduler (policy-gated shared ops) | replaces the `inFlight.size === 0` branches inside `engine/daemon.ts`'s run loop |
| Live-boundary coordinator | `prepareCandidateSelfHost`/teardown verify path in `engine/conductor.ts`, and dispatcher root-mutation call sites (`daemon-cli.ts` rebuild/relink, `daemon-backlog.ts` fastForwardRoot) |
| `daemon_concurrency` config key + `resolveDaemonConcurrency` | `daemon-cli.ts` daemon start path (replacing `clampDaemonConcurrency` at its sole call site), key validated in `engine/config.ts`, declared in the consumer registry |
| Central slug stamp for residual sinks | the `console.warn/error` tee and global bus subscriber in `daemon-cli.ts` |

Early overlap scan: run against the files above (see scan output in session; re-run at
plan time if stale).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1: Behavior drift at concurrency 1 (default) | Technical | Medium | High | Byte-for-byte serial-equivalence acceptance criteria; existing daemon test corpus runs unchanged; clamp test replaced by resolver test |
| R2: Live-boundary false halts under interleaved dispatches | Technical | Medium | High | D6 coordinator; dispatcher-attributed mutations serialized/re-baselined; fail-closed retained for unattributed drift; N>1 self-host integration test |
| R3: Legacy `process.env` mutation branch races at N>1 | Technical | Medium | High | Refuse N>1 on the no-`providerExecution` path (fail closed with a named reason) — condition C2 |
| R4: Multi-feature main-checkout leak defeats all-or-nothing heal; fast-forward silently stalls | Integration | Low | Medium | Refusal must log loudly with the dirty-entry list; multi-candidate triage recorded as future work (ADR consequence) |
| R5: Pinned base vs. a missed tip-equality consumer (beyond the two identified) | Technical | Medium | High | BUILD audit task enumerating `origin/<base>` tip resolvers on the executor path (ADR follow-up); fail toward re-running setup, never skipping it |
| R6: N>1 GitHub API pressure / rate-limit episodes | Performance | Medium | Medium | Episode coordinator already gates new claims (D5); jittered resume already designed for N (adr-2026-07-05 D7) |
| R7: Shared `.git` contention (`worktree add/remove/prune` races) | Technical | Low | Medium | Dispatcher serializes worktree lifecycle ops (single-flight queue); `worktree.ts` failure-path `prune` scoped to its own slug |

## ADRs Created

- `adr-2026-08-27-daemon-dispatcher-executor-seam` — drafted this pass; requires operator
  approval before stories. Plus eight additive amendment notes on the ADRs listed under
  Alignment (applied at approval time, in the same spec branch).

## Conditions (APPROVED WITH CONDITIONS)

1. **Serial equivalence is an acceptance criterion, not a hope:** at resolved concurrency
   1, dispatch order, gate evaluation points, and log shape match today's daemon; the
   existing daemon test corpus passes without semantic edits (mechanical renames allowed).
2. **N>1 refuses fail-closed on the legacy env-mutation path:** if a dispatch would take
   the no-`providerExecution` branch that mutates `process.env`, concurrency >1 for that
   dispatch is refused with a logged reason (R3).
3. **Stories must include the negative paths re-opened from
   `architecture-review-2026-07-03-daemon-auto-restart-stale-engine` condition 1:**
   work-in-flight suppression under drain-then-act, non-converging restart suppression,
   and the drained-boundary restart ordering (`RESTART_PENDING` write → lock release →
   exit).
4. **No live-boundary exclusion is added** (adr-2026-08-17 D4); interleaving correctness
   comes from attribution/serialization only, and unattributed drift still halts.
5. **The new config key lands with its consumer-registry row, validation, resolver, and
   docs in the same diff** (adr-2026-08-26 D4; Documentation Upkeep rule).
6. **The park entry-point enumeration test (adr-2026-07-13 D3) extends to the dispatcher
   claim path** so no unguarded build-start site can appear.
