# ADR 005: Non-autonomy by construction + read-only governor

**Date:** 2026-06-25
**Status:** APPROVED
**Deciders:** James (solo dev) + harness architecture-review
**Feature:** Phase 9.3 — supervisor/engineer (capstone)
**Decision surfaces:** DS-7 (non-autonomy enforcement, FR-10), FR-8 (engineer ≠ daemon parent),
FR-9 (governor)
**Relationship to prior design:** **Departs from** `supervisor-engineer-followup.md` §9.3.

## Context

The predecessor design (`supervisor-engineer-followup.md` §9.3) proposed the engineer as a **supervisor
process that spawns project-scoped workers** and **owns a cross-project rate-limit/token broker all
daemons defer to**. The locked Phase 9.3 PRD (Key Decisions #1, #6; Non-Goals) **reverses both**:
the engineer is a **planning/routing service that does not *manage* daemons**, and the governor is
**read-only — it reports, it does not gate or broker** (FR-9). **Operator refinement
(2026-06-25):** the engineer MAY *launch* a project's daemon as a **detached, fire-and-forget** process
(operator convenience, since the operator is present in the Claude session) — but never manages one
(FR-8, revised). Launching ≠ managing; the daemon stays independent and fault-isolated. The single
non-negotiable, carried from §2 of the followup: **no build proceeds without a human-merged spec
PR** (FR-10); harness self-edits are propose-only PRs.

Forces:
- At solo scale, the per-daemon self-limit (Phase 9 program decision) suffices; a broker is
  unjustified coordination cost and a shared failure point.
- Daemons staying independent gives fault isolation (one daemon dying doesn't take down planning).
- "Non-autonomy" is only credible if there is **no code path** from engineer → build/merge — omission
  is not a guarantee.

## Options Considered

### Governor: (A) read-only reporter vs (B) gating broker
- **A read-only:** engineer computes/report rates + spend from the store; never throttles. *Pros:* no
  coordination tax, no shared failure point, matches solo scale. *Cons:* blind contention possible
  if many daemons run at once (not observed; deferred).
- **B broker:** daemons defer to a central limiter. *Pros:* global rate-limit obedience. *Cons:*
  couples daemon liveness to the engineer; premature for solo scale; reverses fault isolation.

### Non-autonomy enforcement: (A) structural (no import/call path) vs (B) convention
- **A structural:** the engineer module must not import/invoke the pipeline/build or any merge entry
  point; a test asserts it. *Pros:* "no engineer→build" is verifiable, not hoped. *Cons:* a guard test
  to maintain.
- **B convention:** rely on reviewers/prose. *Pros:* nothing to build. *Cons:* exactly how
  autonomy leaks creep in.

## Decision

**Read-only governor (Option A) + structural non-autonomy (Option A).** This is a deliberate
departure from followup §9.3's broker/supervisor-spawns-workers vision, justified by solo scale and
fault isolation; the §9.3 broker is **deferred unless real contention is observed**.

**Mechanism (locked):**
- **Engineer may launch, never manage, a daemon (FR-8, revised):** the engineer MAY *start* a project's
  daemon as a **detached, fire-and-forget** process (operator convenience). It **never manages** one
  — no control connection/IPC/retained handle, no stop/restart, no supervision, no lifecycle
  ownership, and it writes no daemon-supervision state. A launched daemon is fully independent
  (fault-isolated); the engineer may still *read* its signals from the shared store (read-only
  governor), which is not a control connection. There is no post-merge watcher.
- **Human-merge gate unaffected (FR-10):** a launched daemon **only builds human-merged specs**, so
  spawning creates **no** autonomous build path — the just-authored spec PR stays unmerged until the
  human merges it. There remains no `engineer → build` path.
- **Read-only governor (FR-9):** reporting only reads the store (no writes, no throttling). Empty
  store → safe zeros (no divide-by-zero); malformed lines skipped + counted (consistent with the
  9.1 resilient-parse convention).
- **Non-autonomy by construction (FR-10):** the engineer module does **not** import or invoke the
  pipeline/build entry point or any merge (`gh pr merge`/merge API) entry point **directly**; a
  **structural test** asserts this, and additionally asserts that any daemon launch is **detached**
  (no retained handle/IPC, no supervision/control-state write). Every path from idea → build passes
  through a human-merged spec PR — including through a engineer-launched daemon, which builds merged
  specs only.
- **Self-edits propose-only:** any harness change the engineer proposes is emitted as a PR through the
  existing validation/no-auto-merge gates — never auto-applied to the working tree.

## Consequences

### Positive
- Non-autonomy is verifiable, not aspirational; daemons keep fault isolation; no premature broker.
- Governor is pure read — safe to run anytime, no side effects on execution.

### Negative
- No global rate-limit obedience across concurrently-running daemons (accepted at solo scale; the
  §9.3 broker remains the documented escalation if contention is observed).
- A structural guard test must be maintained as the engineer's imports evolve.

### Follow-up Actions
- [ ] Structural test: engineer imports neither build/pipeline nor merge entry points directly.
- [ ] Detached-launch helper: engineer may start a daemon fire-and-forget; test asserts no retained
      handle/IPC and no supervision/control-state write.
- [ ] Governor reader: aggregate spend + kickback/halt/retry rates, read-only; empty/bad-line safe.
- [ ] Document the §9.3-broker deferral (escalation trigger: observed multi-daemon contention).
