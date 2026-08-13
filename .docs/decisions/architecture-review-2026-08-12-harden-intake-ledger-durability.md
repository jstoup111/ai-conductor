# Architecture Review: Harden Intake Ledger Durability

**Date:** 2026-08-12
**Mode:** Lightweight (Medium tier — Sections 2 and 4 only)
**Track:** technical (no PRD; review input is the explore output + technical intent)
**Source:** intake jstoup111/ai-conductor#1476
**Stories reviewed:** none yet — this review runs before `/stories`, per
adr-2026-06-29-architecture-before-stories-convergent-kickback
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment | Flag |
|---|---|---|
| **Stack compatibility** | Pure Node/TypeScript. No new dependency: `conduct-state-lease.ts` already exists in-repo and is generic over any path. `node:fs/promises` primitives already imported by the target file. | None |
| **Prerequisites** | None. No migration, no config change, no external account. The on-disk `ledger.json` format is unchanged — only the reaction to an unparseable one changes. | None |
| **Integration surface** | 2 modules changed (`intake/ledger.ts`, `conduct-state-lease.ts`), 2 modules' error handling reviewed (`engineer-cli.ts` 7 sites, `engineer/loop.ts` 1 site). Does not cross a domain boundary — all inside the engineer intake subsystem plus one shared primitive. | Below the 3-boundary threshold |
| **Data implications** | No schema change. New on-disk artifacts: `ledger.json.lease/` (transient) and `ledger.json.corrupt-«timestamp»` (durable, operator-owned). Both inside `.engineer/`. Data-**loss** risk is what this work removes. | Confirm `.engineer/` ignore rules cover both new artifacts |
| **Performance risk** | Lease acquire/release adds two filesystem syscalls per ledger operation, including read-only ones. Ledger operations are per-idea, not per-request; volume is single-digit per minute at most. Acquire timeout defaults to 1s. | Negligible; no unbounded work introduced |
| **Worktree isolation** | The lease path is derived from the ledger path, so two worktrees with distinct `.engineer/` directories never contend. No fixed port, no shared DB, no global lockfile. Tests must use a per-test temp ledger path or they will serialize against each other. | Test-side only — noted in Risks |

**Verified claims underpinning this section** (per `/verify-claims`):

- `loadStore` conflates absent with unparseable and the result is persisted — **100%, verified**
  by reading `intake/ledger.ts:94-102` and confirming all eight methods follow
  `load → mutate → saveStore`.
- No lock/CAS exists in `intake/ledger.ts` — **100%, verified** (no lease import; full file read).
- 7 `createLedger` sites in `engineer-cli.ts` plus `engineer/loop.ts` — **100%, verified** by grep.
- `conduct-state-lease.ts` is path-generic, mkdir-atomic, has owner liveness and stale recovery,
  and has exactly one current consumer — **95%, verified** by reading the module and grepping
  importers. Residual 5%: dynamic/indirect importers would not appear in a literal grep.
- `engineer/loop.ts:258-267` swallows `ledger.record()` errors — **100%, verified**.

**Assumptions surfaced.** None remain unconfirmed and load-bearing. The two forks that would have
changed the design — scope (corrupt-read only vs. corrupt-read plus locking) and corrupt policy
(refuse vs. quarantine-and-continue) — were both put to the operator and explicitly decided
before this review was written. No design element rests on an unconfirmed assumption.

## Complexity

Skipped — Medium tier. Already assessed at `.docs/complexity/harden-intake-ledger-durability.md`.

## Alignment

**Against APPROVED ADRs.**

- `adr-2026-08-01-conduct-state-mutation-port` — **strongly aligned, and the governing
  precedent.** It already decides, for the comparable conduct-state store, that the filesystem
  adapter "serializes all writers with a bounded cross-process lease, reads the latest snapshot
  while holding that lease... and persists with an atomic temporary-file replacement," and that
  "an unacquired or unrecoverable lease fails closed rather than writing concurrently." Its
  follow-up list explicitly names "corrupt-file, lease-recovery" behavior as needing pinned
  tests. This feature applies the same decided pattern to the second filesystem store in the
  repo. That materially lowers the novelty — and therefore the risk — of the design.
- `adr-012-durable-intake-ledger-sole-dedup-authority` — **partially falsified in its
  Consequences section**, which offers "a lost/corrupt `ledger.json` falls back to the GitHub
  label" as the mitigation. The label covers only entries that reached `done`, carries none of
  the lifecycle metadata, and does not exist for the `claude-session` source. Handled by an
  additive amending ADR rather than by editing ADR-012, matching the repository's own precedent
  (ADR-012 itself carries `amends: adr-009-intake-adapter-port`) and preserving the append-only
  rule. **ADR-012's decision clauses are unchanged and remain authoritative.**
- `adr-2026-07-22-heartbeat-lease-deferred` — **no conflict, but a live confusion risk.** That
  ADR defers a *claim ownership* lease for the #243 duplicate-processing window. This feature's
  lease is a short-lived file-write mutual exclusion and does not close that window. The
  amending ADR carries an explicit scope-boundary section so a future reader cannot mistake one
  for the other.
- `adr-011-async-intake-queue-and-github-source` — aligned. The `.engineer/` vs `.daemon/`
  disjoint-directory invariant is preserved; the new lease directory sits under `.engineer/`,
  and `daemon-lock.ts` is untouched.

**Against `CLAUDE.md` project conventions.**

- *Deterministic where possible; LLM only where necessary* — fully satisfied. Every element is
  mechanical: a parse-failure branch, a byte copy, a `mkdir`-atomic lease. No judgement, no agent.
- *Extend the existing event spine; never add a parallel channel* — the corrupt-ledger warning
  is written to stderr and surfaced as a non-zero exit, mirroring `halt-issues/ledger.ts`. It is
  a synchronous, operator-facing diagnostic on the failing command, not a telemetry channel, and
  it introduces no watcher, poller, sidecar, or second ledger. **This must be re-confirmed
  during `/plan`** if the design grows toward recording corrupt-ledger occurrences for later
  reading — that would be a spine concern and requires the `event-spine` skill's procedure.
  Recorded as a condition below.
- *Third-party calls are smoke-only in tests* — unaffected; no external boundary is touched.

**Pattern consistency.** The design introduces no new pattern. It borrows two existing ones —
`whileHoldingLease(read → mutate → write)` from `filesystem-conduct-state-store.ts`, and the
quarantine-and-warn step from `halt-issues/ledger.ts` — and deliberately diverges from the
latter's return-empty ending. That divergence is a real architectural decision and is why an ADR
is required despite the feature's modest size.

**State management.** The `LedgerStatus` union is already an explicit enum with no boolean flags;
this work does not touch it. The one state-representability improvement is the point of the
feature: "ledger is empty" and "ledger is unreadable" cease to be the same representable state.

**Security boundaries.** The intake ledger is the harness's only untrusted-input path (issue
bodies originate from GitHub). This change does not add an input surface. It does make the
existing one fail closed, which is a net improvement. The quarantine file inherits the ledger's
own permissions and contains no data the ledger did not already hold — no new exposure.

**Production DI defaults.** No in-memory store is introduced as a production default. The ledger
remains filesystem-backed; the lease is filesystem-backed. Test seams are injected, not
registered as defaults.

## Domain Integrity

Skipped — Medium tier (handled by the TDD domain reviewer per cycle).

## Wiring Surface

Design-time commitments for every production surface this feature introduces or changes:

| Surface | Kind | Where it is called from in production |
|---|---|---|
| `withLedgerLease` (or equivalently-named internal guard) in `intake/ledger.ts` | internal function | Called by every method of the object `createLedger` returns — the eight existing `Ledger` methods. Not exported; reachable only through the `Ledger` interface. |
| Changed `loadStore` corrupt branch | internal function | Reached through `withLedgerLease` on every `Ledger` method call. |
| `Ledger` interface (unchanged signatures, changed failure behavior) | exported seam | Already wired: `engineer-cli.ts` at the 7 `createLedger` sites, and `engineer/loop.ts` via `deps.ledger`. No new wiring needed — this is why the interface is deliberately kept stable. |
| Corrupt-ledger stderr warning | operator diagnostic | Emitted from the corrupt branch above; surfaces on whichever `conduct-ts engineer` verb triggered it. |
| Non-zero exit on corrupt ledger | CLI behavior | The existing `engineer-cli.ts` error path; a rejected `Ledger` promise already propagates to the verb's exit code at 6 of the 7 sites. |
| Corrected error handling in `engineer/loop.ts:258-267` | changed control flow | The intake capture path, invoked by the long-running engineer loop's poll cycle. |
| Generalized diagnostics in `conduct-state-lease.ts` | changed shared primitive | Existing consumer `filesystem-conduct-state-store.ts:130`, plus the new ledger consumer. |
| `ledger.json.corrupt-«timestamp»` | on-disk artifact | Written by the corrupt branch; read by an operator following the runbook. |

No surface here is a new entry point — every one is reached through call paths that already exist
in production. That is the main reason this feature's unreachable-rung risk is low.

**Early overlap scan.** `conduct-ts overlap-scan` over these paths reported ~40 branches touching
`intake/ledger.ts`. **These are false positives.** Spot-checking two of them
(`origin/spec/background-intake-conduct-loop`, `origin/spec/per-step-provider-routing-927`) with
`git diff $(git merge-base <branch> origin/main) <branch> -- <path>` returned empty diffs — the
branches are spec-only with stale merge-bases, so the scan's comparison attributes main's own
movement to them. **No genuine concurrent work on this feature's surface.** Advisory only; does
not affect the verdict.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A corrupt ledger now blocks all intake until an operator intervenes, where it previously degraded silently | Technical | Low | **High** | Accepted trade — refusing is correct for a dedup authority. Mitigated by a documented recovery runbook (Condition 1) and by a warning that names both file paths so recovery is obvious. |
| A stuck or orphaned lease directory blocks every ledger operation, including read-only `list`/`get` used for inspection | Technical | Low | **High** | `conduct-state-lease.ts`'s stale-owner recovery reclaims a lease whose owner pid is dead. The residual case is a *live* process holding it indefinitely, bounded by the acquire timeout returning a clear error. Runbook must cover manual lease-directory removal (Condition 1). |
| The lease is mistaken for the deferred #243 claim-ownership lease, and `adr-2026-07-22-heartbeat-lease-deferred` is wrongly considered resolved | Knowledge | Medium | Medium | Explicit scope-boundary section in the amending ADR; called out in this review's Alignment section. |
| Reusing `conduct-state-lease.ts` verbatim emits "conduct-state lease" diagnostics for intake-ledger failures, misdirecting an operator | Technical | **High** (certain if unaddressed) | Low | Condition 2 — generalize the primitive's naming/diagnostics in the same change. |
| Tests that share a ledger path serialize on the real lease, producing slow or flaky suites | Technical | Medium | Low | Per-test temp ledger paths, and the lease's existing DI seams for unit tests. `.agents/skills/write-tests` applies. |
| Correcting the `loop.ts` swallow lets an unrelated envelope-level error abort the intake phase, a regression the original bare catch existed to prevent | Technical | Medium | Medium | Narrow the catch to genuinely per-envelope failures rather than removing it; the corrupt-ledger failure must escape while a malformed envelope is still absorbed. Pinned by a story. |
| Quarantine files accumulate unboundedly under repeated corrupt reads | Data | Low | Low | Timestamped names make them enumerable; the refusal means a corrupt ledger is fixed quickly rather than re-encountered indefinitely. No reaper in scope. |

## ADRs Created

- `adr-2026-08-12-fail-closed-intake-ledger-durability.md` — **APPROVED by the operator
  2026-08-12**, and therefore authoritative on all downstream work.
  Amends `adr-012-durable-intake-ledger-sole-dedup-authority` (additive; supersedes nothing).
  Records: absent vs. unparseable as distinct outcomes; refusal rather than continue-empty;
  quarantine by copy rather than rename; operator notification at the time of the corrupt read;
  lease-serialized read-modify-write reusing `conduct-state-lease.ts`; the lease living under
  `.engineer/`; and the explicit scope boundary against the deferred #243 claim lease.

No ADR was superseded.

## Conditions

The verdict is APPROVED **with these conditions**, to be carried into `/plan` as tasks and
checked at code review and at `/finish`:

1. **Ship the operator recovery path with the code.** A runbook section covering: how to
   recognize the corrupt-ledger refusal, how to inspect `ledger.json.corrupt-«timestamp»`, how to
   repair or replace `ledger.json`, and how to clear a stuck `ledger.json.lease/`. Without this,
   the accepted availability trade-off has no documented exit and the two High-impact risks above
   are unmitigated. Per `CLAUDE.md` Documentation Upkeep this must land in the **same** PR.

2. **Generalize `conduct-state-lease.ts` diagnostics** so its messages do not say "conduct-state"
   when guarding the intake ledger. Reusing the primitive without this ships a misleading error.

3. **Preserve the per-envelope isolation** that `engineer/loop.ts:258-267` provides while letting
   a corrupt-ledger failure escape it. Both behaviors must be pinned by tests; do not simply
   delete the catch.

4. **Re-run the `event-spine` decision procedure during `/plan`** if the design acquires any
   mechanism for recording corrupt-ledger occurrences to be read back later. A synchronous stderr
   warning plus a non-zero exit is not a telemetry channel and needs no spine change; anything
   durable and machine-read would.

5. ~~**Confirm `.engineer/` ignore rules cover `ledger.json.lease/` and
   `ledger.json.corrupt-*`** so neither can be committed accidentally.~~ **WITHDRAWN.**

   > **Amended 2026-08-12 by #1476 (same DECIDE pass):** this condition rested on an unverified
   > assumption that the engineer directory is repo-relative. It is not.
   > `resolveEngineerDir` (`src/conductor/src/engine/engineer-store.ts:185-193`) returns
   > `$AI_CONDUCTOR_ENGINEER_DIR`, defaulting to `~/.ai-conductor/engineer/` — outside every
   > working tree. Verified directly: `git check-ignore` finds no rule because no rule is needed,
   > and the live ledger is `~/.ai-conductor/engineer/ledger.json` (103KB, 296 entries at
   > authoring time). Nothing here can be committed or trip the self-host live boundary, so there
   > is no ignore rule to add. The condition is withdrawn rather than deleted, and the story that
   > implemented it (originally Story 9) is removed from
   > `.docs/stories/harden-intake-ledger-durability.md`.
   >
   > **This correction strengthens the feature rather than shrinking it.** The ledger is a
   > **user-global, cross-repo singleton**: every registered project's CLI verbs and every
   > engineer loop on the machine mutate the same file. The concurrent-writer population in the
   > Feasibility table is therefore not "7 verbs plus one loop in this repo" but that set across
   > **all** projects, and a single wipe destroys dedup for all of them simultaneously. The
   > Risks table's severity assessment for the corrupt-ledger case should be read with that
   > larger blast radius in mind; the mitigations are unchanged.

## Blocking Issues

None.
