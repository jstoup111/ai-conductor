# ADR: Build settle outcome stamp and pre-dispatch no-op refusal

Status: APPROVED
Feature: build-agent-disputing-a-wiring-check-kickback-in-p
Issue: jstoup111/ai-conductor#1336
Date: 2026-08-05

## Context

`checkKickbackToBuildEscalation` (`conductor.ts:3390`) is the only place the engine compares a
tree hash across a build cycle, and it runs on the **gate's re-failure** — strictly downstream of a
fully paid build dispatch. When a build agent answers a `wiring_check` kickback by disputing the
gate in prose rather than editing the tree, three things follow, and all three are structural:

1. The build step settles from the provider's own status (`conductor.ts:7503-7522`). No tree
   observation happens at that boundary, so `daemon-cli.ts:2055` renders `build ✓ done` for a turn
   that changed zero bytes.
2. The halt reason is composed from `shouldEscalateKickback`'s generic string
   (`kickback-escalation.ts:78-80`), which cannot reference anything the agent said.
3. Detection is post-payment. #984 made the kickback *count* durable across dispatches, but the
   count is bumped by `consumeKickbackBudget` (`conductor.ts:3344`) — which also runs after the
   turn is paid for. Nothing refuses the next dispatch.

Observed cost: 4 halts across 3 features in 2 days, each burning 0.5M–2.4M input tokens and
producing nothing, then classified `needs-human` so `daemon-rekick.ts:186` skips the feature on
every subsequent sweep.

### Verified claims

| Claim | Basis | Confidence |
|---|---|---|
| The only cross-build tree comparisons are on the gate-failure path (`conductor.ts:3362`, `:3390`) | verified — read both call sites and all 12 `checkKickbackToBuildEscalation`/`captureKickbackToBuildContext` references | 95% |
| `build_progress`/`build_no_progress` are polling-cadence heartbeats that a 1-turn build never trips | verified — `build-progress-watcher.ts` header + `resolveBuildProgressConfig` cadence knobs | 90% |
| No module anywhere in `src/conductor/src` consumes a build agent's dispute | verified — grepped `dispute`/`disagree` across src, skills, agents; only unrelated attribution-audit hits | 95% |
| `wiring_check` re-derives evidence **only** when HEAD moved (`artifacts.ts:2580`), so a no-commit build leaves the recorded verdict standing by design | verified — read the full predicate | 95% |
| The retry-escalation rung (`escalation.ts`) resets per dispatch, because `let attempt = 0` (`conductor.ts:4896`) is inside the per-step loop inside a per-dispatch `run()` | verified — read the declaration and its enclosing scope | 85% |
| The provider's final text is **already persisted** — `step_completed` carries `tail` (last 200 lines of `successOutput`, `conductor.ts:7508`) into `.pipeline/events.jsonl` (`event-persister.ts:125,195`) | verified — read the emit site, the event type, and the persister | 90% |

The last row materially corrects this feature's framing. The agent's prose is **not** unrecorded;
it is recorded in the event log and then **read by nothing** and **rendered by nothing**
(`daemon-cli.ts:2055` drops `tail` entirely). The defect is a missing consumer and a missing
render, not a missing capture.

### Surfaced assumptions

- *That a build step's terminal outcome is always observable at one boundary.* Impact if wrong: a
  stamp written only on the success path goes stale relative to an intervening failed attempt, and
  the refusal below then compares against the wrong cycle. Addressed by D4.
- *That the tree hash is a sufficient key for "the same cycle".* Impact if wrong: the refusal
  declines work that would have run differently. Addressed by D3.

## Decision

**D1 — The observation point moves to the build step's settle boundary.** The engine hashes the
worktree tree before and after every `build` step and records the result. Everything the four
outcomes need — the log line, the durable record, the repeat fingerprint, and the halt-reason
material — is derivable from that one stamp. Placing it at the gate instead keeps the record
downstream of payment, which is the defect itself.

> **Amended 2026-08-06 by #1336:** the stamp records **two** movement witnesses, not one. Conflict
> check found that `adr-2026-07-23-commit-movement-liveness-floor` (APPROVED) already maintains a
> HEAD **commit-SHA** witness inside the same build step — captured at step entry
> (`conductor.ts:4940`) and re-rolled per attempt (`:4949`, `:6273`), driving the `no_task_progress`
> classifier and the `unattributed_progress` event. This ADR's tree-hash witness (inherited from
> #984, which moved off commit SHA because an empty commit moves HEAD while leaving the tree
> byte-identical) would have contradicted it in the log on exactly that case. Resolution: the record
> carries `treeBefore`/`treeAfter` **and** `headBefore`/`headAfter`; the tree hash remains the sole
> **classification** witness for `moved`/`no-movement` and therefore the sole input to the refusal;
> the commit SHA is recorded for legibility only. Every operator-facing string is **tree-scoped**
> ("tree abc1234 unchanged"), never an unqualified "no movement". The tree-hash baseline is captured
> beside the existing `headShaBeforeBuild` probe rather than at a new site.
> `adr-2026-07-23-commit-movement-liveness-floor` is unchanged and is **not** superseded — each
> guard keeps the witness its own ADR chose.

**D2 — The stamp is engine-authored; any agent artifact is enrichment only.** This repository's
Design Principle states that a repeatedly-violated rule needs machinery, not a stronger prompt. An
agent-authored dispute contract would have covered **zero** of the four observed halts, because
disputing in prose is exactly what the agents did. `.pipeline/build-outcome.json` is therefore
written by the engine from data it already computes (`currentTreeHash`, `countResolvedTasks`) plus
the `tail` `step_completed` already carries. `.pipeline/build-dispute.json` is read when present and
ignored when absent; every outcome must hold with it absent.

**D3 — A pre-dispatch refusal, keyed on a definite match, refuses an already-empty cycle before
paying for it.** Before re-entering `build` under an active kickback, compare the current
`(gate, tree hash, gate verdict, escalation rung)` tuple against the last stamp. The refusal fires
only on a **definite** match: every component present, comparable, and equal. Any difference — a
moved tree, a different gate, a changed verdict, a higher model/effort rung — dispatches normally.

The polarity here is deliberately **inverted** from `classifyBuildProgress`
(`kickback-escalation.ts:35-41`), which folds a null tree hash into `'no-work'`. That fold is
correct there: it is the conservative direction for *escalating* a spin. It is the wrong direction
here, where an unobservable tree must mean "dispatch" rather than "refuse" — refusing on absent
evidence would decline legitimate work. Two guards, opposite failure directions, both fail-safe for
their own question.

The escalation rung is in the key even though `attempt` resets per dispatch (`conductor.ts:4896`),
so a fresh dispatch re-enters at rung 1 and the tuple matches on the cross-dispatch axis this
targets. It is included as cheap insurance: the guard must never be able to refuse a strictly
more-capable retry, and that property should not depend on a scoping detail elsewhere in the file.

**D4 — The stamp is written on every terminal outcome of the build step, not only on success.**
Success, `step_failed`, and a no-verdict outcome (including `authFailure`) each write a stamp
recording which one occurred. A success-only stamp would leave the refusal comparing against a
stale cycle whenever an attempt failed in between. Only a stamp whose outcome is `no-movement` can
satisfy D3's match.

**D5 — The captured note adopts `step_completed`'s existing 200-line tail bound.** Not "verbatim
provider text". The bound already exists at `conductor.ts:7508` and already lands in the same
gitignored `.pipeline/` directory, so the stamp introduces **no new secrets-exposure class and no
new size class** — it re-records material already persisted, under the same cap. An unbounded
capture would have been a new risk; this is not.

**D6 — The `HaltClass` union is NOT extended.** A `needs-decide` member was considered and
rejected (operator decision, 2026-08-05). It would have unlocked no automatic behavior —
`daemon-rekick.ts:186` would have had to skip it exactly as it skips `needs-human` — so the only
gain was a label, paid for with a change to a union with three consumers plus its migration path.
Operator legibility is delivered by the halt reason text and by the stamp's machine-readable
`category` field (`disputes-gate` / `belongs-to-decide` / `silent-no-movement`). Anything that wants
to branch on the distinction reads the stamp.

**D7 — `build-outcome.json` is a new sidecar, not a field on `kickback-ledger.json`.** The ledger's
lifecycle is *the bound*: per-gate counts consumed and reset by progress, cleared on a fresh feature
session. The stamp's lifecycle is *the observation*: one record per build settle, written whether or
not any gate ever kicks back. Coupling a guard to a log would entangle two independent lifecycles.
The new module follows the same atomic temp-file + `rename(2)` write and fail-open read as
`kickback-ledger.ts:67-116`.

**D8 — The engine does not adjudicate the dispute.** Two of the observed agents claimed the gate's
evidence was stale. Whether `artifacts.ts:2580`'s HEAD-gated re-derivation is right is #1249/#1175's
question; forcing a re-derive at an unchanged HEAD would change `wiring_check` freshness semantics
for every consumer. This change records the claim and names the decision. It does not rule on it.

## Consequences

**Positive.** The largest halt cluster in the current daemon log becomes legible from the log alone.
An identical empty cycle costs zero tokens on its second occurrence instead of 0.5M–2.4M. The
agent's stated conclusion reaches the operator instead of dying in an unread event field. No agent
behavior change is required for any of it.

**Negative / accepted.** `.pipeline/` is gitignored and per-worktree, so deleting `.worktrees/<slug>`
discards the stamp and a fresh dispatch is allowed. That is the #497 class, and it fails **open** —
a fresh budget, never a spurious refusal — which is the correct direction for a guard whose failure
mode is declining real work. This matches the disposition #984 already accepted for the kickback
ledger, so it introduces no new operational rule.

The `category` field is derived from unstructured prose when `build-dispute.json` is absent, so it
is a heuristic label. It is therefore advisory-only: it may enrich the halt reason and the stamp,
and it must not gate any control-flow decision. Only the `moved` / `no-movement` classification —
computed from tree hashes, not text — is load-bearing.

**Superseded/affected.** None. `kickback-escalation.ts` and `kickback-ledger.ts` keep their current
responsibilities unchanged; #984 retains sole ownership of the kickback cap.

## Alternatives considered

- **Require an agent-authored dispute artifact (rejected).** Depends on prompt discipline and would
  have covered none of the four observed halts. Retained as optional enrichment only.
- **Mechanically re-derive wiring evidence at an unchanged HEAD to settle the staleness claim
  (rejected).** Changes `wiring_check` freshness semantics for every consumer and overlaps
  #1249/#1175. Out of scope by operator decision.
- **Extend the kickback ledger instead of adding a sidecar (rejected).** See D7.
- **Raise `MAX_KICKBACKS_PER_GATE` or add a second counter (rejected).** The defect is not the cap;
  it is that detection happens after payment. A counter change cannot make the first repeat free.
