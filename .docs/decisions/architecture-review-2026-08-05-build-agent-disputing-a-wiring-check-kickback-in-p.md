# Architecture Review: Engine-stamped build outcome for a disputed kickback

**Date:** 2026-08-05
**Issue:** jstoup111/ai-conductor#1336
**Tier:** M (lightweight mode — §2 Feasibility + §4 Alignment; §3/§5 skipped per skill)
**Track:** technical
**Input reviewed:** `.docs/architecture/build-agent-disputing-a-wiring-check-kickback-in-p.md`,
`.docs/architecture/sequences/build-agent-disputing-a-wiring-check-kickback-in-p.md`,
`.docs/complexity/…`, `.docs/track/…`, `.memory/decisions/build-dispute-no-op-kickback.md`
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding |
|---|---|
| **Stack compatibility** | Clear. No new dependency. `currentTreeHash` and `countResolvedTasks` are already imported and used at `conductor.ts:3345-3348`; the sidecar reuses `kickback-ledger.ts`'s atomic-write pattern verbatim. |
| **Prerequisites** | None. No migration, no config, no external setup. `.pipeline/` already exists per worktree. |
| **Integration surface** | 5 files: one new module, `conductor.ts` (settle boundary + refusal + halt-reason composer), `types/events.ts`, `ui/create-renderer.ts`, `daemon-cli.ts`. Within Medium. |
| **Data implications** | New gitignored sidecar only. No schema, no tracked-file change, nothing to backfill. A missing/corrupt sidecar fails open by design. |
| **Performance risk** | Two `git` calls per build step (tree hash before/after) on a boundary that already runs several. Negligible against a multi-minute build turn. |
| **Worktree isolation** | Clean. `.pipeline/` is per-worktree and gitignored; two worktrees cannot contend. No port, DB, queue, or shared path introduced. |

**Correction to the design's framing (material, verified).** The architecture document states the
agent's conclusion is discarded. It is not: `step_completed` already carries `tail` — the last 200
lines of `successOutput` (`conductor.ts:7508`) — and `event-persister.ts:125,195` appends the whole
event to `.pipeline/events.jsonl`. What is missing is a **consumer** and a **renderer**:
`daemon-cli.ts:2055` prints `build ✓ done` and drops `tail` on the floor, and nothing anywhere reads
it back. This makes the feature cheaper than specified and changes two design details (Conditions
C3 and C4 below). It does not change the approach.

## Alignment

**Design Principle (deterministic where possible).** Strongly aligned, and the review specifically
endorses the rejection of an agent-authored dispute contract as the primary mechanism. All four
observed halts featured agents disputing in prose; a contract requiring structured output would have
covered none of them. Engine-stamped is the correct polarity.

**Pattern consistency.** The new sidecar follows an established precedent chain —
`task-evidence.json` → `build-review-regrade.json` → `kickback-ledger.json` — same atomic temp +
`rename(2)`, same fail-open read, same per-worktree lifecycle. No new pattern; no departure needing
justification beyond the ADR.

**Domain boundaries.** Respected. `kickback-escalation.ts` stays a pure classifier with no I/O;
`kickback-ledger.ts` keeps sole ownership of the cap; the new module owns only the observation. The
architecture document's insistence that #984 retains the bound is correct and important — the two
concerns genuinely answer different questions.

**State management.** The stamp's `outcome` is an enum (`moved` / `no-movement`), not a boolean
flag, and the pre-dispatch refusal is an explicit tuple comparison rather than an implicit
inference. No invalid state is representable by construction, provided C1 is applied.

**Security boundaries.** No new endpoint, no new user input, no authz surface. The captured note is
addressed by C4.

**Production DI defaults.** Not applicable — no DI container involved; the sidecar is a filesystem
store, which is the persistent-store answer this check exists to require.

**Diagram accuracy.** Both diagrams render (5/5 blocks pass `render-diagrams --check`) and match the
seams as read. Two labels need updating under C3/C4.

## Wiring Surface

| New production surface | Where it is called from in production |
|---|---|
| `build-outcome.ts` — `classifyBuildSettle`, `sameNoOpCycle` (pure) | `conductor.ts`'s step loop; no other caller |
| `build-outcome.ts` — `readBuildOutcome` / `writeBuildOutcome` | `conductor.ts` at the build step's terminal outcome (write) and immediately before a kickback re-entry into `build` (read) |
| `.pipeline/build-outcome.json` | written by the settle boundary; read by the pre-dispatch refusal and by the halt-reason composer at `conductor.ts:4251` / `:6766` |
| New `build_settled` event (or an additive field on `step_completed`) | emitted from the same site as the existing `step_completed` at `conductor.ts:7509`; rendered by `ui/create-renderer.ts` (interactive) and `daemon-cli.ts` (daemon log) |
| Halt-reason composer | invoked at the existing `wiring_check` halt sites, `conductor.ts:4251` and `:6766` |

Design-time commitment only. `/plan` derives each task's `Wired-into:` contract from this table.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Pre-dispatch refusal declines legitimate work when the tree hash is unobservable | Technical | Medium | High | **C1** — definite-match-only; null/absent never refuses |
| Refusal declines a retry that would have run at a higher model/effort rung | Technical | Low | High | **C2** — rung is part of the comparison key |
| Stamp goes stale relative to an intervening failed attempt | Technical | Medium | Medium | **C3** — stamp on every terminal outcome, not only success |
| Heuristic `category` derived from prose drives control flow | Technical | Medium | Medium | **C5** — category is advisory; only tree-derived `moved`/`no-movement` gates |
| Sidecar lost with the worktree (#497 class) resets the guard | Data | Medium | Low | Accepted — fails open, same disposition #984 already took for the ledger |
| Unmerged `origin/spec/build-reports-step-completed-status-done-while-lea` (#1270) touches the same `step_completed` seam | Integration | Medium | Medium | Advisory — see Overlap below; sequence the merge, do not redesign |

No High-likelihood/High-impact risk remains after the conditions.

## Conditions

**C1 — The refusal fires only on a definite match.** Every component of the
`(gate, tree hash, gate verdict, escalation rung)` tuple must be present, comparable, and equal.
A null or unreadable tree hash must **dispatch**, never refuse. This is a deliberate polarity
inversion from `classifyBuildProgress` (`kickback-escalation.ts:38`), which folds null into
`'no-work'` — correct for escalating a spin, wrong for declining work. Do not reuse that helper for
the refusal; the two guards must fail in opposite directions. *(Blocking if unmet — it is the
difference between a guard and a work-stopper.)*

**C2 — Include the escalation rung in the key.** `attempt` resets per dispatch
(`conductor.ts:4896`, inside the per-step loop inside a per-dispatch `run()`), so the tuple already
matches on the cross-dispatch axis this targets. Including the rung anyway guarantees the guard can
never refuse a strictly more-capable retry without that property depending on a scoping detail
elsewhere in a 8000-line file.

**C3 — Stamp every terminal outcome of the build step, not only success.** Write on success,
`step_failed`, and no-verdict (including `authFailure`), recording which occurred. The current design
implies a success-only stamp; that leaves the refusal comparing against a stale cycle whenever an
attempt fails in between. Update the sequence diagram's target flow accordingly.

**C4 — Bound the captured note to `step_completed`'s existing 200-line tail; drop the word
"verbatim."** The architecture document currently says "provider final text verbatim." The bound
already exists at `conductor.ts:7508` and the same material already lands in the same gitignored
`.pipeline/events.jsonl`, so adopting it means the stamp introduces **no new secrets-exposure class
and no new size class**. An unbounded capture would introduce both. Prefer reusing the existing
`tail` value over re-reading provider output.

**C5 — `category` is advisory, never load-bearing.** When `.pipeline/build-dispute.json` is absent
the category is inferred from prose and is a heuristic. It may enrich the halt reason and the stamp;
it must not gate the refusal, the escalation, or the halt disposition. Only the tree-derived
`moved` / `no-movement` classification may gate anything.

All five are design constraints, not open questions. They are tracked into `/plan` and checked at
code review; unmet conditions at `/finish` are blocking.

## Overlap (advisory, non-blocking)

`conduct-ts overlap-scan` over the Wiring Surface paths reports ~40 unmerged branches touching
`src/conductor/src/engine/conductor.ts` — that file is a universal overlap and the signal is mostly
noise. One entry is genuinely adjacent and worth sequencing rather than ignoring:
`origin/spec/build-reports-step-completed-status-done-while-lea` (#1270) edits the same
`step_completed`/build-settle seam this feature instruments. Neither redesigns the other; whichever
merges second rebases onto the first.

## ADRs Created

- `.docs/decisions/adr-2026-08-05-build-settle-outcome-stamp.md` — **Status: APPROVED**.
  D1 settle-boundary observation · D2 engine-authored, agent artifact optional · D3 definite-match
  pre-dispatch refusal with inverted null polarity · D4 stamp every terminal outcome · D5 200-line
  bound · D6 no `HaltClass` extension · D7 separate sidecar · D8 no adjudication.

No existing ADR is superseded. `adr-2026-07-13-kickback-build-no-op-escalation` remains in force —
this change adds an earlier observation point and does not alter its escalation logic.

## Verdict

**APPROVED WITH CONDITIONS.** The approach is sound, conventional against three existing precedents,
and correctly rejects the prompt-discipline alternative. The five conditions above are narrow and
mechanical; C1 is the one that would turn a guard into a work-stopper if skipped. Proceed to
`/stories`.
