# Architecture Review: Mergeable autoresolve tier-2 escalates every content conflict to the operator
**Date:** 2026-09-20
**Stories reviewed:** none yet (pre-stories pass; input is the #2607 intake outcomes and the explore decision)
**Mode:** lightweight (Tier M) — Feasibility and Alignment only
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | No new dependency. All work is inside the existing TypeScript engine and the shared `rebase` skill. |
| Prerequisites | None. `mergeable_autoresolve` already exists and stays opt-in. |
| Integration surface | One subsystem: the sweep's resolver construction in `daemon-cli.ts`, `resolveConflictingPr` / `runTier2` / `escalate` in `engine/autoresolve.ts`, the FR-9 preservation guard in `engine/rebase.ts`, the label pass in `engine/mergeable-sweep.ts`, the watch entry schema, and the `ConductorEvent` union. |
| Data implications | One optional, zero-default field on the watch registry entry (escalation cause). Older entries read as "no recorded cause" and are therefore never auto-cleared. No migration. |
| Performance risk | None added. One resolver session and one suite run per attempt, as today. |
| Worktree isolation | Unchanged. Resolution keeps running in the transient resolve worktree. |

Verified against source (confidence 95%, read directly):

- The sweep constructs its own resolver, so a sweep-only signal can ride `ResolutionContext` without reaching the finish-time call site.
- Tier-2 `conflict_halt` escalates before the acceptance guards, suite gate, and lease push are reached; those stages already exist and need no new verification machinery.
- The FR-9 guard already excuses a dropped commit whose added lines survive in HEAD. PR #2574's dropped commit fails that test because upstream rewrote the same lines, so the declared-drop excusal is genuinely new behavior.
- `isTestPath` in `engine/gate-invalidation.ts` is the existing test-path convention. PR #2574's replay commit touched exactly one file, and it matches.
- `needs-remediation` has four writers: autoresolve escalation, ci-fix exhaustion, setup-stop, and halted-build presentation. Autoresolve's `escalate` writes a marker-tagged comment but no PR body halt marker, so the halt reconciler, which selects on the body marker, does not re-apply a conflict-caused label.

Focused local pattern basis: the verdict follows the engine-stamped envelope precedent of `adr-2026-08-19-engine-stamped-rubric-judged-result-envelope` — the provider returns only the judgement payload against a closed schema, and the engine stamps identity and validates. The trait to preserve is that no engine decision is re-derived from free text. Rediscovery hints: `ResolutionAttempt` and `RebaseResolver` in `engine/rebase.ts`; `resolveRebaseConflict` on the step runner. Allowed variation: the payload's field set is this feature's own.

## Complexity

Skipped in lightweight mode. Tier M is recorded in `.docs/complexity/mergeable-autoresolve-tier-2-escalates-every-conte.md`.

## Alignment

A full pass over all 592 files in `.docs/decisions/` found the design as first proposed was forbidden. `adr-2026-08-01-rebase-full-replay-intent-validation`, written after incident #1152, requires the resolver to stop when source and upstream intent conflict semantically, states that ambiguity is "no longer accepted merely because downstream tests might pass," and holds one skill contract across every invocation. The operator reviewed the risk and narrowed the feature: the judgement exception applies only when every conflicted path is test code. Production-path conflicts keep today's stop. The #1152 safeguards (full-replay inspection, staged-change attribution, post-continue recheck) are untouched.

ADRs amended in this spec (each gains one citable decision, D1):

| ADR | Original assertion | Amendment |
|---|---|---|
| adr-2026-08-01-rebase-full-replay-intent-validation | Stop on semantically conflicting intent; one contract for all invocations | Test-only supersession judgement on the sweep path; engine establishes test-only |
| adr-2026-06-29-rebase-conflict-resolution-dispatch | Dropped commits always halt | FR-9 excuses a declared, replayed, test-only drop on the sweep path |
| adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep | One resolution policy, two entry points | One bounded sweep-only divergence; verdict recorded on the PR and the event spine; no publish without a named passing verification |
| adr-2026-07-04-autoresolve-state-and-config | Label is the operator's single off/on switch | Escalation cause on the watch entry; sweep clears only conflict-caused labels on no-longer-conflicting PRs with no halt marker |

ADRs the design complies with, no amendment:

- `adr-2026-07-03-post-rebase-force-with-lease` — the existing autoresolve lease push is the only force site; none is added.
- `adr-2026-09-11-github-operation-ownership` — the audit comment and the label removal are GitHub mutations; they use the existing `pr-labels` gh seam and add no direct GitHub call (Condition 3). That ADR's boundary is not yet on main.
- `adr-2026-07-26-event-sink-registry-exhaustiveness` and `adr-2026-08-11-halt-events-ride-the-persisted-spine` — any new event variant declares its sink; the verdict rides the existing spine.
- `adr-2026-09-11-selective-post-rebase-verification` — a declared-superseded commit yields no unchanged-replay proof, so revalidation is conservative. Accepted cost.
- `adr-2026-07-12-rebase-evidence-stamp-translation` — a dropped commit must surface as rebase residue, never a silent dangle (Condition 4).
- `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic`, `adr-2026-08-09-one-pr-per-branch-halt-is-a-state`, `adr-2026-07-05-halt-pr-presentation-reliability`, `adr-2026-07-03-halt-pr-rehabilitation-at-finish` — these govern the halted-build label, selected by the PR body marker. The sweep clear refuses any PR carrying that marker, so halt state is never cleared by merge state.
- `adr-2026-07-07-ship-ci-feedback-loop` decision 5 — a ci-fix exhaustion label has no conflict cause recorded and is never cleared.
- `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever` — while a PR is conflicting the label remains the lever; once it is not conflicting there is no autoresolve outcome left to lever.
- `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`, `adr-2026-07-04-resolution-worktree-lifecycle` — fresh session per dispatch and the transient worktree are unchanged.

Domain boundaries: no new coupling. State management: escalation cause is a closed set, not a boolean. Security: PR text reaching the resolver is unchanged from today. Production DI defaults: none introduced. The diagram at `.docs/architecture/mergeable-autoresolve-tier-2-escalates-every-conte.md` reflects the narrowed design.

Design Principle check: machinery does the bookkeeping (test-only classification, verdict validation, declared-drop matching, suite gate, cause-keyed label clear); the LLM makes the one call that is a judgement (which test-side intent survives), constrained by schema.

## Domain Integrity

Skipped in lightweight mode.

## Wiring Surface

| New production surface | Called from |
|---|---|
| Test-only conflict classification | `resolveConflictingPr` in `engine/autoresolve.ts`, after Tier 1 and before `runTier2`, reusing `isTestPath` |
| Judgement-exception signal on the resolution context | Passed by `runTier2` into the shared `resolveRebaseConflicts` loop, which is the one place a `ResolutionContext` is built; consumed by the step runner's `resolveRebaseConflict` prompt; the finish-time and re-kick callers of that loop pass nothing, so it defaults off |
| Schema-bound resolution verdict on the resolver result | Returned by `resolveRebaseConflict`; validated in `resolveConflictingPr` before the acceptance guards |
| Declared-drop excusal in the FR-9 guard | `runAcceptanceGuards`, called from `resolveConflictingPr`; finish-time callers pass no declarations |
| Resolution audit comment | `resolveConflictingPr`, after a successful `publishResolution`, through the guarded GitHub boundary |
| Verdict event | Emitted from the sweep resolver path on the existing `ConductorEventEmitter`; sink declared in `EVENT_SINKS` |
| Escalation-cause field on the watch entry | Written by the sweep's autoresolve dispatch handling in `engine/mergeable-sweep.ts` when the outcome is an escalation |
| Conflict-caused stale label clear | The sweep's per-entry label pass in `engine/mergeable-sweep.ts`, before autoresolve eligibility |
| Sweep judgement section of the `rebase` skill | Loaded by the same `/rebase` dispatch; active only when the engine signals the exception |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Resolver picks the wrong test-side intent and the suite still passes | Technical | Low | Medium | Test-only scope means no runtime behavior ships from the choice; audit comment; nothing merges without the operator; pre-push SHA recoverable |
| Declared-drop excusal used as a general `--skip` | Technical | Low | High | Engine, not the skill, checks the commit was replayed and touched only test paths; any other missing commit fails FR-9 as today |
| Exception leaks to finish-time rebase | Technical | Low | High | Signal exists only on the sweep's resolver construction; story-level negative criterion; amended ADRs name the boundary |
| Sweep clears a label another writer owns | Integration | Low | High | Clear requires a recorded conflict cause and no halt body marker; absent cause means never clear |
| Test-path convention misclassifies a production file under a `test/` directory | Technical | Low | Medium | Reuses the convention the gate-invalidation classifier already trusts; suite gate still runs |
| Later pressure to widen to production paths | Knowledge | Medium | Medium | Requires a further ADR amendment; audit comments are the evidence base for that decision |

## ADRs Created

None. Four APPROVED ADRs amended additively (table above); each remains `Status: APPROVED`.

## Conditions

1. The engine, not the skill or the verdict, decides that a conflict is test-only and that a declared drop qualifies.
2. No path reachable from `runRebaseStep`, re-kick, or manual invocation sets the judgement-exception signal; a test proves it.
3. The audit comment and the label removal use the existing `pr-labels` gh seam (`upsertComment`, `removeLabel`) and add no direct GitHub call, so the ownership boundary of adr-2026-09-11-github-operation-ownership, which is not yet on main, governs them wherever it attaches to that seam.
4. A declared-superseded commit is recorded as rebase residue on the existing residue event.
5. Nothing is published unless the verification command is named in the audit comment and exited zero.
6. Plans and stories add no production-path judgement; widening needs a new ADR amendment.

## Blocking Issues

None after the operator's test-only narrowing.
