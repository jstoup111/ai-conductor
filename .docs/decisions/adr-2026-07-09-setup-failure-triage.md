# ADR: Deterministic setup-failure triage (quarantine + bounded fix-session)

**Date:** 2026-07-09
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session for jstoup111/ai-conductor#446

## Context

`bin/setup` runs before every agent dispatch (`makeRunFeature` → `prepareWorktree`,
daemon-runner.ts:192–204). A non-zero exit throws (worktree-prepare.ts:114–117) and the
feature is errored + parked with the worktree kept; `ensureWorktree` (daemon-deps.ts:64–79)
returns that same broken tree on every re-dispatch. A dead build agent (auth expiry, retries
exhausted, daemon kill — #351/#437) that leaves the tree unable to pass setup therefore wedges
its feature permanently: no agent can ever be dispatched to fix the breakage that blocks
dispatch. Three operator hand-repairs in 24h (~20–30 min each) motivated #446.

Constraints: the harness design principle is deterministic-first (machinery wherever possible,
LLM only where genuinely necessary); nothing may be silently discarded (preserve-then-heal
discipline established by `leak-triage.ts`, #380/#435); zero behavior change when setup
passes; the bounded-LLM-dispatch shape is already established by the gated `/rebase` resolver
(`resolveRebaseConflicts` cap loop, rebase.ts:542+; fresh `DefaultStepRunner` per attempt,
daemon-cli.ts:1216+).

## Options Considered

### Option A: Two-stage triage at the prepare seam (chosen)
Stage 1 (machinery): on setup failure with a dirty tree, preserve ALL uncommitted/untracked
state, reset to HEAD, re-run setup exactly once. Stage 2 (LLM): if setup still fails at a
clean HEAD, dispatch ONE bounded fix-session whose prompt is the setup stderr tail, with an
explicit success contract; on failure, HALT naming the error and the quarantine ref.
- **Pros:** covers all three observed instance classes; stage boundaries match the
  deterministic-first principle exactly; both stages mirror shipped precedents.
- **Cons:** largest scope — new engine module plus one new LLM dispatch surface.

### Option B: Quarantine-only
Ship stage 1; committed breakage still HALTs (with a better message).
- **Pros:** no new LLM surface; small.
- **Cons:** the committed-breakage class (auth-expiry kills mid-commit — the most common
  killer per #351) keeps costing ~20–30 min of operator repair per recurrence.

### Option C: Unconditional dirty-tree reset at re-dispatch
- **Pros:** simplest.
- **Cons:** regresses the resumability contract — resumed agents legitimately continue from
  uncommitted WIP. Rejected outright.

## Decision

Option A, with these binding sub-decisions:

1. **Seam:** triage lives in a new pure, dependency-injected engine module
   (`engine/setup-triage.ts`) invoked from `makeRunFeature`'s prepare step when — and only
   when — `prepareWorktree` fails in a **daemon** dispatch. The `autoresolve.ts` prepare path
   and manual `/conduct` runs are out of scope (unchanged). Setup exit 0 ⇒ byte-for-byte the
   existing dispatch path.
2. **Quarantine mechanism:** a commit on a dedicated branch ref
   `wip/setup-quarantine-<slug>` created from the worktree HEAD containing ALL uncommitted
   and untracked state (git add -A of the dirty tree), followed by `reset --hard HEAD` +
   clean of the now-preserved strays on the feature branch. A branch ref (not a stash, not a
   `.pipeline/` copy) keeps the state GC-reachable, inspectable with normal git tooling, and
   survives worktree teardown. If a quarantine branch for the slug already exists, it is
   refreshed (force-moved) — the previous quarantine tip remains in the reflog. Preserve
   strictly BEFORE any reset; a preservation failure aborts triage (fail toward the current
   error-park behavior, never toward data loss).
3. **Retry bound:** setup re-runs exactly ONCE after quarantine (machinery stage). No
   mechanical retry loops.
4. **Fix-session bound + contract:** exactly ONE fix-session dispatch per feature rotation,
   following the rebase-resolver shape (fresh step-runner session; injected seam so tests
   never spawn a real agent). Prompt carries the setup stderr tail. Success contract,
   verified mechanically by the engine — never trusted from the agent: `bin/setup` exits 0
   on re-run AND the worktree is clean (fix committed). Contract met ⇒ dispatch proceeds
   normally. Contract failed ⇒ diagnostic HALT (existing `.pipeline/HALT` shape) naming the
   setup error tail and the quarantine ref; the feature parks operator-gated exactly as today.
5. **Surfacing:** the quarantine ref and setup stderr tail are named in the daemon log and in
   any resulting HALT; the resuming build agent is told the quarantine ref exists so
   legitimate WIP can be recovered deliberately.

Claims basis (verify-claims): current generic error-park path, worktree reuse, resolver
precedent, and HALT shape all **verified** by direct reads (files/lines cited above). Branch
refs surviving `reset --hard` + teardown is standard git semantics (**verified**). Assumption
(inferred, non-decision-changing): most setup failures are deterministic per tree state
(build/type errors); transient failures (npm network) are absorbed harmlessly by the same
retry-once + fix-session ladder.

## Consequences

### Positive
- The error→rekick→error wedge class is eliminated; the daemon self-heals both uncommitted
  and committed breakage, each by the cheapest sufficient mechanism.
- Nothing is ever silently discarded; operator repair (when still needed) starts from a named
  quarantine ref and a named compiler error instead of forensic diagnosis.
- Zero happy-path cost; zero change outside daemon dispatch.

### Negative
- One more LLM dispatch surface to budget/monitor (bounded to 1 per rotation).
- Quarantine branches accumulate until cleaned (teardown-on-ship removes the worktree, not
  the ref); acceptable — refs are tiny and named, cleanup can ride a later sweep.
- A fix-session commits code to the feature branch without the TDD cycle; bounded by the
  mechanical contract and by all downstream build/review gates still applying.

### Follow-up Actions
- [ ] Stories + plan for `engine/setup-triage.ts`, `prepareWorktree` failure classification,
      `makeRunFeature` wiring, fix-session step-runner method, HALT/log surfacing.
- [ ] Negative-path tests: preservation failure aborts triage; quarantine never triggers on
      setup exit 0; legitimate WIP survives byte-for-byte in the quarantine ref.
