# Architecture Review: Unhalt after main advance resumes against stale feature base

**Date:** 2026-08-11
**Issue:** jstoup111/ai-conductor#1245
**Stem:** `unhalt-after-main-advance-resumes-against-stale-fe`
**Track:** technical · **Tier:** M (lightweight review — Feasibility + Alignment)
**Input:** `.docs/track/…md`, `.docs/complexity/…md`, `.docs/architecture/…md` (operator-approved)
**Verdict:** APPROVED WITH CONDITIONS

Stories do not exist yet — this review runs pre-`/stories`, against the explore output and the
technical intent, per `adr-2026-06-29-architecture-before-stories-convergent-kickback`.

## Scope

**In:** issue outcomes 1-5 (the stale-base resume defect).
**Out (operator-set):** the park/HALT race observability outcome — the issue's last bullet —
split to its own intake issue. This review does not design it.
**Constraint (operator-set):** seal handling must reuse the existing audited rebaseline path;
no new authorization channel.

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | Clean. No new dependency, no new service. Both primitives exist: `resolveFreshBase` (`rebase.ts:274-330`) and `isBranchCurrent` (`rebase.ts:360-367`). Verified by direct read. |
| **Prerequisites** | None. No migration, no config key, no schema change. The `ConductorEvent` union gains a variant, which is additive. |
| **Integration surface** | Three modules: `daemon-cli.ts` (the seam), `daemon-rekick.ts` (`resumeRebaseFirst`'s guard), `types/events.ts` + `event-sinks.ts` (the variant). `daemon.ts` supplies the halt-resume signal. Under the 3-boundary flag but close to it — noted below. |
| **Data implications** | None. No persisted format changes. The seal's `rebaselines[]` grows through the existing rotation path, unchanged. |
| **Performance risk** | Bounded and small: two git commands per halt-resume, plus one `ls-remote` round-trip when the tracking ref is stale. This is not a per-poll cost — halt-resume is rare. `resolveFreshBase` deliberately skips the fetch when the tracking ref already matches the remote head. |
| **Worktree isolation** | Unaffected. All state stays inside the feature's own worktree (`.pipeline/`); the evaluator reads refs and writes nothing outside it. No new ports, services, or shared paths. |

**No blocking feasibility concern.** The change composes tested primitives at an existing
seam rather than introducing new git logic — `git cherry` and `patch-id` filtering are
explicitly *not* needed (see Assumption Ledger).

## Alignment

**Deterministic-where-possible (CLAUDE.md design principle).** Fully satisfied and worth
stating plainly: the fix is engine machinery, not prompt discipline. The base-advance verdict
is computed from git refs; the play-forward is deterministic; the only LLM in the path is the
pre-existing bounded `/rebase` conflict resolver, which is already provider-routed by config.
This is exactly the precedent CLAUDE.md cites — replacing an operator ritual with machinery
that acts at the moment of the failure.

**Event spine.** Checked against `.agents/skills/event-spine/SKILL.md` before the design was
written down:

```
Event spine
  Channel?    no new channel   — a verdict computed at dispatch, emitted on the bus
  Concern:    occurrence       — "the base was evaluated and found advanced/current/undeterminable"
  Verdict:    extend the union — new ConductorEvent variant + sink entry
  Exception:  none             — the emitter is reachable from the daemon call site
```

No sidecar file, no bespoke log, no timestamp stamped into an existing artifact. Precedent
for the shape: `build_review_base` (`events.ts:328-336`) and `rebase_mergeable_skip`
(`events.ts:548-556`), both pure telemetry carrying which base was compared.

*Observation, not a finding for this feature:* `halt_cleared` exists as a union member
(`events.ts:689`) emitted from `conductor.ts:6718`, but `daemon-deps.ts:339` also hand-writes
a record of the same name straight to the audit trail with `appendFileSync`, bypassing the
emitter. The written shape matches `audit-trail.ts:182-186`, so this is one schema and not a
parallel channel by the §3 test. Out of scope here; noted so a future reader does not
mistake it for a new divergence introduced by this work.

**Pattern consistency.** The design follows two established local patterns rather than
inventing one: policy decided at the daemon call site with the conductor left provider- and
mode-neutral (mirroring `runRebaseStep`'s hard noop for non-daemon runs,
`conductor.ts:9139-9147`), and recovery routed through a single shared play-forward
(mirroring `#300`'s extraction of `runGatedRebaseResolution` so the finish-time and re-kick
paths could not drift).

**State management.** The evaluator's result is a three-valued verdict
(`current` / `advanced` / `undeterminable`), not a boolean. This is deliberate and is the
single most important modeling choice in the design: a two-valued "is it stale?" collapses
"verified current" and "could not verify" into the same answer, and — given `resolveFreshBase`
fail-softs to a local ref on any git or network error — that collapse would license a rebase
onto an unverified base. Invalid states are unrepresentable: there is no way to reach the
play-forward without a resolved remote base.

**Domain boundaries.** The change respects the existing split: `rebase.ts` stays pure and
git-injected with no event coupling; the daemon layer owns policy and event emission;
`resumeRebaseFirst` keeps ownership of the play-forward sequence. No module reaches across
into another's state.

**Provider-agnostic.** Yes. Nothing in the evaluator or the trigger references a provider.
The only provider-touching element is the pre-existing `/rebase` resolver dispatch, routed by
`steps.rebase.llm_provider` in `.ai-conductor/config.yml` (currently pinned to `claude` by
operator order). No new provider assumption is introduced.

**Security boundaries.** No new inputs, endpoints, or credentials. `ls-remote` uses the
repository's existing origin configuration.

**Diagram accuracy.** `.docs/architecture/unhalt-after-main-advance-resumes-against-stale-fe.md`
matches this review; all three Mermaid blocks parse (`conduct-ts render-diagrams --check`).

## Wiring Surface

Design-time commitments for each new production surface. No `file:line` yet — the code does
not exist. This is the precursor `/plan` derives its `Wired-into:` contracts from.

| New surface | Where it will be called from in production |
|---|---|
| Base-advance evaluator (exported function, engine module) | Invoked from `runConductorInWorktree` in `daemon-cli.ts`, after the `isOperatorParked` check and before `resumeRebaseFirst`. |
| Base-advance verdict type (three-valued) | Returned by the evaluator; consumed by the same call site and by the emitted event's payload. |
| Explicit trigger option on `resumeRebaseFirst` | Passed by that same `daemon-cli.ts` call site; read by the existing guard at `daemon-rekick.ts:447`. |
| New `ConductorEvent` variant | Emitted through the feature's existing `ConductorEventEmitter` (`featureEvents`, already constructed in `runConductorInWorktree`); consumed by the daemon renderer, the persister, and the audit trail via its `event-sinks.ts` entry. |
| Halt-resume signal | Produced by the daemon's existing per-slug halt bookkeeping (`daemon.ts:779-800`, `:155-164`) and the durable `.pipeline/HALT.cleared` marker; read at the dispatch call site. |

Every surface terminates at a real production entry point — the daemon loop's dispatch path.
None is a helper that only tests would call.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A resume that used to dispatch instantly now hits a rebase conflict and re-halts | Technical | Medium | Medium | Existing bounded `runGatedRebaseResolution` then HALT — the same containment today's re-kick resume uses. The HALT reason must name base-advance as the trigger so it is not mistaken for the original finding. |
| `undeterminable` mishandled as `advanced`, rebasing onto an unverified local ref | Technical | Low | **High** | Three-valued verdict makes the state explicit; the `undeterminable` path is a required test case. `resolveFreshBase`'s fail-soft is reachable in normal operation (no origin, `ls-remote` failure), so this is not hypothetical. |
| Sentinel one-shot semantics eroded by the second entry condition | Technical | Low | High | `adr-2026-08-11-play-forward-entry-trigger` keeps consumption inside `resumeRebaseFirst` unchanged; all four guard combinations are required test cases. |
| Park precedence regressed at the new seam | Technical | Low | **High** | Evaluator placed strictly after `isOperatorParked`; explicit test that a parked worktree with an advanced base is neither evaluated nor rebased and keeps its sentinel. |
| HALT cleared while the daemon is stopped is not evaluated | Technical | Low | Low | Accepted, documented in `adr-2026-08-11-play-forward-entry-trigger`. Closing it needs either state-to-infer-occurrence (rejected by the event-spine principle) or per-dispatch evaluation (rejected for blast radius). |
| Repeated manual clears each spend a rebase attempt against a persistently conflicting base | Technical | Low | Low | Each attempt is bounded by the configured resolution cap; the conflict HALT is distinguishable and the operator can park. |
| Integration surface sits at 3 module boundaries | Integration | — | Low | Boundaries are along existing seams (daemon policy / rekick play-forward / event union); no new coupling direction is created. |

## Assumption Ledger

Per `/verify-claims`, load-bearing assumptions with basis and confidence. No APPROVED
decision here rests on an unconfirmed assumption.

| Assumption | Basis | Confidence | If wrong |
|---|---|---|---|
| A clean rebase drops the upstream-equivalent commit, so no patch-equivalence filter is needed in `build_review` | Inferred from standard git rebase behavior, plus **verified** that `featureCommitsPreserved` (`rebase.ts:826-838`) runs only on the conflict path (`rebase.ts:940`) and so cannot reject the drop | 90% | The false Scope attribution survives the fix. **Operator directed this be proven by a required regression story** rather than accepted — see Conditions. |
| `resolveFreshBase`'s local fail-soft is reachable in normal operation | Verified by reading `rebase.ts:284-300` and its documented triggers (no origin, discovery failure, `ls-remote` failure, `rev-parse` failure) | 98% | The `undeterminable` branch would be dead code rather than harmful. |
| Routing through `performRebase` delivers seal rebaseline with no manual reseal | Verified: seal verified pre-HEAD-move at `rebase.ts:681-698`; rotation with trigger `proactive-rebase` at `rebase-translate.ts:437-476`; defensive rotation at `protected-artifact-seal.ts:1016-1060` | 95% | A manual `conduct-ts reseal` would still be needed, defeating an in-scope outcome. Covered by a required story. |
| The daemon's per-slug halt bookkeeping is a sufficient halt-resume signal for a running daemon | Verified for the watcher lifecycle (`daemon.ts:779-800`) and the durable-HALT branch (`daemon.ts:155-164`); the daemon-down case is a **known** gap, not an assumption | 92% | Some halt-resumes go unevaluated — degrades to today's behavior, never worse. |

## Adjacent unmerged work

`conduct-ts overlap-scan` over the wiring-surface paths returns heavy overlap on
`daemon-cli.ts` (~40 unmerged spec branches touch it) — advisory only, and characteristic of
that file rather than of this change. One branch is directly adjacent and worth naming:
`spec/re-kick-sentinel-can-strand-an-active-feature-outs` (#1232). Its stories are explicitly
**reporting-only** ("Nothing in these stories clears a sentinel, dispatches a feature, parks a
worktree, or removes a worktree"), so it is complementary to this change rather than
conflicting — it reports stranded sentinels, this one reduces how often recovery depends on a
sentinel at all. `/conflict-check` should confirm formally.

## ADRs Created

| ADR | Decision | Status |
|---|---|---|
| `adr-2026-08-11-resume-time-base-advance-evaluation` | The seam, the three-valued predicate, and spine-based observability | APPROVED |
| `adr-2026-08-11-play-forward-entry-trigger` | Explicit trigger at the call site; sentinel semantics preserved | APPROVED |

## Conditions

Approved subject to these, all tracked into `/stories` and checked at code review:

1. **A regression story must prove the graded diff is clean.** After a resume-triggered
   rebase, the upstream-equivalent commit must be absent from `build_review`'s graded diff,
   *and* the same diff without the rebase must still fail Scope. This is the operator-directed
   proof of the 90% assumption; it is the difference between fixing the defect and assuming it
   away.
2. **The `undeterminable` verdict must have explicit coverage** asserting no rebase occurs.
3. **All four `resumeRebaseFirst` guard combinations must be covered** (sentinel only, trigger
   only, both, neither), including that "both" consumes the sentinel exactly once.
4. **Park precedence must have an explicit regression test** — a parked worktree with an
   advanced base is neither evaluated nor rebased, and its unconsumed sentinel survives.
5. **A resume-triggered rebase must require no manual reseal** — asserted against the seal's
   `rebaselines[]` lineage, not merely the absence of a HALT.
6. **The conflict HALT must name base-advance as its trigger**, so an operator can tell it
   from the original finding.

## Blocking Issues

None.
