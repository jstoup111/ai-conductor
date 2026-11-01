# Architecture Review: A routed fix refreshes a published stack (#3269)
**Date:** 2026-11-01
**Inputs reviewed:**
- `.docs/track/a-published-stacked-child-changes-silently-when-a-.md` and its complexity record, Tier L
- `.docs/architecture/a-published-stacked-child-changes-silently-when-a-.md`
- `adr-2026-10-17-stacked-feature-publication-as-native-stack`, `adr-2026-10-12-routed-whole-feature-repair`, `adr-2026-10-24-operator-route-round-for-closed-stacked-children`, `adr-2026-10-10-stacked-restack-journaled-replay`
- A source trace of the freeze, the push path, FINISH re-entry and the daemon's handling of a finished slug
- GitHub's stacked pull request documentation, read 2026-11-01

**Verdict:** APPROVED WITH CONDITIONS

## Feasibility
Feasible on the current stack, with no new dependency. The restack, revalidation queue, push intents and receipts, and the guarded comment operation all exist. The trace found two gaps the design must close: a finished slug cannot be re-dispatched, and `restageLeafGates` does not re-pend `finish`. Decision 4 of the ADR closes both.

No schema migration or backfill: the new ref is absent on existing features, and absent means nothing is owed. Worktree isolation is unaffected: all new state is per-slug Git refs.

## Complexity
High: a state-machine change in FINISH, a relaxed fail-closed guard, a change to daemon dispatch eligibility, and an external write. Estimated at about 24 tasks, below the plan's 30 ceiling, and sliced by operator direction. The operator approved one spec rather than a split (§3a).

## Alignment
- **Publication ADR decision 11** is deliberately narrowed, by amendment. The tip guard stays the single chokepoint.
- **Restack ADR decisions 9 and 11** are not falsified, so that ADR is not amended; the publication ADR already recorded its narrowing, and the new ADR governs the exception.
- **Event spine:** two new `ConductorEvent` variants; the ledger is durable state, not telemetry, and the dispatch eligibility reads existing Git state rather than a new marker.
- **`adr-2026-09-11-github-operation-ownership`:** comments use an existing `feature-write` operation under a per-member target-bound runner.
- **Production DI:** all state is in Git refs. No in-memory default is introduced.

## Domain Integrity
- The ledger is parsed at the boundary like the publication record, and an unreadable ledger fails closed: no rewrite is allowed and FINISH does not record an outcome.
- A comment's target is a closed variant (`host` or `member-above`), so its marker shape cannot mix.
- A refresh authorization is a typed capability passed by FINISH, not a boolean flag on a shared helper.

## Wiring Surface
| New surface | Production caller |
|---|---|
| Refresh ledger writer | `appliedTransactionLines` in the restack executor, re-rendered by recovery; the leaf-host settle in `requestRoutedExit` |
| Refresh ledger reader | FINISH snapshot, the tip guard's rewrite arm, the backlog eligibility check |
| Tip preflight | Route admission, `checkOpenOperatorRound`, `planRemediation`'s routing arm, `admitRoutedTasklessKickback` |
| Guard rewrite arm | `guardPublishedStackWrite`, reached from `executeRemoteGit` |
| `refresh_published_members` transition | The FINISH transition selector and its production executor |
| `post_routed_comments` transition | The FINISH transition selector and its production executor |
| Reopen sweep | `openOperatorRound`, reached from `stack land` |
| `finish` re-pend | `returnToLeaf` through `restageLeafGates` |
| Dispatch eligibility | `isProcessed` and `claims.isCompleted` handling in the daemon backlog and dispatcher, plus the re-kick skip |
| `stack_member_refreshed`, `stack_member_comment_posted` | Emitted by the two FINISH transitions; registered in `event-sinks.ts` and the persister |

**Overlap scan:** only `routing/routed-exit.ts`, against `spec/routed-round-advance-carries-the-previous-host-s-e`, whose PR #3423 has merged. No open work collides.

## Risks
| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| The engine overwrites a reviewer's push | Data | Low | High | Lease at the pushed receipt, and every member tip must match, at each write |
| A rewrite is authorized from a forged or stale tip | Security | Low | High | The ledger moves only inside the restack transaction, and the arm needs FINISH's authorization |
| A reopened feature re-dispatches forever | Integration | Medium | High | Eligibility ends when the ledger is empty and the round is closed; FINISH re-marks the slug processed |
| A crash leaves the stack non-linear | Integration | Medium | Medium | FINISH resumes per receipt; GitHub refuses to merge a non-linear stack |
| A member merges during an open round | Data | Medium | Medium | Preflight at admission and the guard at FINISH both refuse, then halt `stack-tip-diverged` |
| Duplicate comments on retry | Integration | Medium | Low | Marker scan before create, durable receipt, and lookup failure never creates |
| A published member's body diffstat goes stale | Knowledge | High | Low | Named in the ADR consequences, with a follow-up intake |

## ADRs Created
- `adr-2026-11-01-routed-fix-refreshes-a-published-stack` (APPROVED by the operator 2026-11-01)

## Conditions
- The plan's coverage must include every `publishedStackRefusal` caller, stating for each one whether it changes or stays frozen (decisions 1 and 10).
- The plan must prove the freeze lifts only in the last slice (decision 11).
- The plan must include a test that a non-refresh caller still cannot rewrite a published member (decision 3).
