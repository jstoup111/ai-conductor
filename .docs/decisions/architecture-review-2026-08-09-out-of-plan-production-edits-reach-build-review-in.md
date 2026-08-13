# Architecture Review: Non-blocking plan-scope containment recorder

**Date:** 2026-08-09
**Mode:** design-time, lightweight (Medium tier → Feasibility + Alignment only)
**Track:** Technical
**Source:** intake `jstoup111/ai-conductor#1390`
**Input reviewed:** `.docs/track/…`, `.docs/complexity/…`, `.docs/architecture/…` and its sequence
(stories and plan do not exist yet at this point)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment | Flag |
|---|---|---|
| **Stack compatibility** | No new dependency. Every surface is an existing TypeScript module in `src/conductor/src/engine/` plus one union member in `src/conductor/src/types/events.ts`. | none |
| **Prerequisites** | None external. The containment evaluator, `Scope:` trailer grammar, widening harvest, and `build_review` prompt section all merged in PR #1349 (2026-08-08). | none |
| **Integration surface** | Six engine modules plus the event union — above the 3-boundary threshold, so flagged. Mitigated: five of the six are single-predicate or single-field edits, and the crossings are all within one subsystem (the BUILD commit path). | **flagged, accepted** |
| **Data implications** | No schema, no migration, no backfill. One new append-only JSONL ledger, written best-effort, read tolerantly. | none |
| **Performance risk** | The check already runs on every attributed commit. Floor widening adds a bounded per-path predicate over the task's declared file list; the ledger append is one `appendFileSync`. Neither is on a hot loop. | none |
| **Worktree isolation** | `.pipeline/hook-events.jsonl` is per-worktree, inside the already-per-worktree `.pipeline/`. No shared port, DB, queue, or file. Two worktrees committing concurrently write to separate ledgers. | none |

**Unresolved-at-design-time:** none. The two questions that could have changed the decision — whether
`feat/daemon-pipeline-commits-files-outside-the-active-plan-bef` carries live contention, and whether
`.pipeline/pipeline-events.jsonl` is available to build on — were both resolved against evidence
before the ADRs were written (see Risks R1, R2).

## Alignment

**Documented decisions.** Checked against `.docs/decisions/`.

- `adr-2026-08-08-pipeline-owned-closeout-timestamps` — **consistent.** Its D2 (one writer per
  ledger file) is followed, not deviated from: the git-hook process and the pipeline CLI are
  different writers, so a distinct hook-owned file is what D2 requires. Reconciliation is recorded
  in `adr-2026-08-09-hook-owned-containment-event-ledger`.
- `adr-2026-07-10-intra-step-build-progress-events` — **consistent.** Its rejection of runner-push
  on no-bus-access grounds is the precedent cited for exception A.
- PR #1349's merged design (`.docs/architecture/pipeline-commits-files-outside-the-active-plan-bef.md`)
  — **deliberately amended.** That design's component diagram shows an `exit 2 — commit refused`
  edge as the intended terminal state of the containment check. This feature removes that edge by
  operator direction. See the amendment note below.

**Repository design principles** (`CLAUDE.md`).

- *"Deterministic where possible; LLM only where necessary."* — **honored, with a caveat worth
  stating plainly.** The floor, the rationale resolution, and the ambiguity record are all
  deterministic. The *verdict* on whether a widening was legitimate stays with the `build_review`
  LLM. This is a conscious retreat from the stronger deterministic position that PR #1349's design
  contemplated, and it is justified by measured false-positive risk (the adjacency gap below), not
  by convenience. The principle's own test — "can machinery do this mechanically?" — is answered
  *yes for detection, no for judgement*, which is the correct split.
- *"Extend the existing event spine; never add a parallel channel."* — **honored.** The `event-spine`
  procedure was run before the design was authored; verdict block recorded in both the architecture
  doc and the ledger ADR. One union, one parser, one reader path.
- *"Third-party calls are smoke-only in tests."* — not applicable; no third-party boundary.

**Pattern consistency.** The exit-code contract between an engine CLI and a generated hook already
exists (`scope-check` returns 0/2 today); adding 3 extends it rather than introducing a pattern.
The sibling-ledger-plus-merge pattern is established by the closeout ADR.

**State management.** The check's outcome becomes a three-valued classification — in-floor,
out-of-floor, unresolvable — replacing today's conflation of "not applicable" and "crashed" behind a
single exit `1`. That is a strict improvement in representable-state hygiene: the current encoding
makes an invalid state (a crash indistinguishable from a healthy skip) representable, and this
removes it.

**Security boundaries.** No new endpoint, no new user input crossing a trust boundary. The commit
message is already parsed by this code path. One note carried to Conditions: the derived-rationale
path copies commit-message text into a ledger and thence into an LLM prompt, so the appender must
not let a crafted message break the JSONL record — standard JSON encoding, not string
concatenation.

**Production DI defaults.** No in-memory store registered as a production default. The ledger is
filesystem-backed.

## Wiring Surface

Design-time commitments — where each new or materially changed production surface is called from.

| Surface | Wired into |
|---|---|
| Widened floor predicate in `evaluateScopeContainment` (`plan-scope-containment.ts`) | Already called by `runScopeCheck` (`scope-check-cli.ts`), dispatched at `index.ts:692` from the generated `commit-msg` hook. No new wiring. |
| Rationale resolver (trailer-first, message-fallback) | Called by `runScopeCheck` before recording, and by `runPerTaskCommitFloor` (`per-task-commit-floor.ts`) when harvesting at the build-step boundary. |
| `derived` flag on `AcceptedScopeWidening` (`per-task-commit-floor.ts`) | Rendered by the existing `## Engine-accepted scope widenings` section in `build-review-prompt.ts`, reached via `build-review-inputs.ts` and `step-runners.ts:1710`. Additive field on an existing interface. |
| New `ConductorEvent` variant (`types/events.ts`) | Written by the new appender in `scope-check-cli.ts`; consumed by the engine's ledger merge and by existing bus subscribers once re-emitted. |
| `.pipeline/hook-events.jsonl` | Written by `conduct-ts scope-check` only. Read by the engine's tail-and-merge path and by `runPerTaskCommitFloor` at the build-step boundary. |
| Exit code 3 from `runScopeCheck` | Consumed by the regenerated `COMMIT_MSG_HOOK` branch in `git-hook-assets.ts`. |
| `build_review.scopeContainmentEnforced: true` in this repo's `config.yml` | Read by the existing `resolveBuildReviewConfig` (`resolved-config.ts`) via `loadScopeCheckEnforcement`. No new key. |

Every row lands on an existing caller. This feature introduces no free-standing primitive, which is
the shape most likely to ship green-but-unwired.

## Accepted-artifact amendment

`.docs/architecture/pipeline-commits-files-outside-the-active-plan-bef.md` asserts, in its component
diagram, that a containment violation terminates as `exit 2 — commit refused`. That assertion is
falsified by this review. Per the amendment protocol, the note below is to be added beside the
original assertion in that file — additively, leaving the original intact — as part of this spec's
diff:

```markdown
> **Amended 2026-08-09 by #1390:** the containment check no longer refuses a commit. `exit 2` is
> retired and reserved; a violation now exits 0 with an advisory and is recorded as an accepted
> widening for `build_review`. The refusal edge was never enabled in production — enforcement
> shipped `false` — and is withdrawn because the floor it would have enforced rejects adjacent test
> files and same-directory neighbors. See `adr-2026-08-09-non-blocking-plan-scope-containment`.
```

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| **R1** — `feat/daemon-pipeline-commits-files-outside-the-active-plan-bef` appeared to carry 401 unmerged lines across all four core files | Integration | — | — | **Retired.** PR #1349 merged from that head ref on 2026-08-08; the diff is a squash-merge ancestry artifact. Verified via `gh pr list`. No live contention. |
| **R2** — building on `.pipeline/pipeline-events.jsonl` from the APPROVED closeout ADR | Integration | — | — | **Retired.** That ledger is unimplemented on main and sits in PR #1395 (OPEN, needs-remediation). This feature owns a separate file, which D2 requires anyway. |
| **R3** — "same-directory neighbors" is broad enough to neuter containment in flat directories | Technical | Medium | Medium | Operator-directed. The recorded-widening stream is the instrument that will show it; revisit when self-host data exists. Not blocking. |
| **R4** — derived rationales inherit commit-message quality; a terse message yields a useless "why" and `build_review` kicks back anyway | Technical | Medium | Medium | The `derived` flag lets the grader weigh authored trailers above inferred ones; the advisory stderr teaches the agent the trailer form for next time. |
| **R5** — three ledgers after #1395 lands; merge and clock-skew handling must tolerate any subset being absent | Integration | Medium | Low | All writers stamp `ts` from the same host clock; readers already required to tolerate absence (E3). |
| **R6** — union-member collision with PR #1395, which also adds a variant to `types/events.ts` | Integration | Low | Low | Additive variants on a discriminated union; distinct `type` values. Textual conflict at most, resolved by rebase. |
| **R7** — a crafted commit message breaks the JSONL record when copied into a derived rationale | Security | Low | Medium | Condition C2 below. |

No High-impact risk registered.

## ADRs Created

| ADR | Covers |
|---|---|
| `adr-2026-08-09-non-blocking-plan-scope-containment` | Floor widening, trailer-first/message-fallback rationale, never-refuse contract, config default and its deliberate non-rename, and the explicit departure from intake outcome 1 |
| `adr-2026-08-09-hook-owned-containment-event-ledger` | New `ConductorEvent` variant, `.pipeline/hook-events.jsonl` single-writer sibling ledger, exit-code split, best-effort-write / tolerant-read, and reconciliation with the closeout ADR |

Both require operator approval before this spec may land.

## Conditions

Tracked into the plan; checked at code review; unmet conditions block at `/finish`.

- **C1 — The amendment note above is applied** to
  `.docs/architecture/pipeline-commits-files-outside-the-active-plan-bef.md` in this spec's diff,
  additively. A merged design that still shows a refusal edge will mislead the next reader of this
  subsystem.
- **C2 — The ledger appender JSON-encodes rationale text.** Commit-message content reaches the
  ledger and then an LLM prompt; the record must be built with `JSON.stringify`, never string
  concatenation, so a newline or quote in a commit message cannot forge or split a record.
- **C3 — The appender cannot throw into the hook.** Every failure path in the write must be
  swallowed and the commit allowed, per E3. A test must prove a commit succeeds with the ledger
  path unwritable.
- **C4 — Exit code 2 stays unused and reserved.** Do not reuse it for the advisory path; a future
  enforcement decision should be able to adopt it without renumbering.
- **C5 — Consumer default is not changed.** `DEFAULT_SCOPE_CONTAINMENT_ENFORCED` stays `false`; only
  this repository's own `config.yml` opts in. A diff that flips the shipped default violates the
  operator's blast-radius direction.
- **C6 — Documentation travels in the same PR.** `docs/reference/configuration.md` for the redefined
  key semantics, and `docs/explanation/gates.md` for the fact that containment is a recorder and not
  a gate.

## Verdict

**APPROVED WITH CONDITIONS.** The design is feasible on the current stack with no new dependency, is
consistent with every APPROVED ADR it touches, honors the event-spine and determinism principles,
and lands every new surface on an existing caller. Both integration risks that could have changed
the decision were resolved against evidence rather than assumed. Conditions C1–C6 carry into the
plan.
