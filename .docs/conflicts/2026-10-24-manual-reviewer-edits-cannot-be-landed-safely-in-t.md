# Conflict Check: Land manual changes in the stacked child that owns them (#3203)

**Date:** 2026-10-24
**Stories checked:** `.docs/stories/manual-reviewer-edits-cannot-be-landed-safely-in-t.md` (Stories
1–15) against every story file touching closed children, routing, restack, park, rewind, commit
hooks, HALT clearing, kickback budgets and dispatch. That is 209 candidates by keyword, read in full
where they overlap.
**Result:** clean after resolution. Two blocking and twelve degrading conflicts were found, and all
were resolved by operator approval on 2026-10-24. No degrading compromise remains accepted.

## Blocking (resolved)

### Conflict: Interactive conductor runs would start honouring park on stacked features
**Stories involved:** #3203 Story 2 vs `park-in-flight-features-at-step-boundaries-after-p` Story 9
and `daemon-park-does-not-stop-retries-inside-an-alread` Story 13; ADR
`adr-2026-07-29-operator-park-scheduling-unit-boundary` D2.
**Type:** contradiction. **Severity:** blocking.
**ADR filename stem:** adr-2026-07-29-operator-park-scheduling-unit-boundary
**Story ID:** Story 2
**ADR opposing sentence (verbatim):** "Interactive conductor construction omits it and is byte-for-byte unchanged."
**Story opposing sentence (verbatim, before resolution):** "Given a dispatch that acquires the lease and then finds `.daemon/parked/demo` present, when it re-checks the park, then it releases the lease and skips the unit without preparing the worktree or writing a HALT."
**Resolution:** An interactive conductor run takes the lease but does not re-check the park. An
undeclared landing is stopped at resume by the `operator-round-undeclared` check. #3203 ADR decision
2 and Story 2 were revised; `adr-2026-07-29` stands unamended.

### Conflict: A raw commit on a published stack gets a halt whose recovery command refuses
**Stories involved:** #3203 Story 7 vs `stacked-features-cannot-be-published-reviewed-and-` Story 10
and #3203 Story 1; ADR `adr-2026-10-17-stacked-feature-publication-as-native-stack` decision 11.
**Type:** sequencing. **Severity:** blocking.
**ADR filename stem:** adr-2026-10-17-stacked-feature-publication-as-native-stack
**Story ID:** Story 7
**ADR opposing sentence (verbatim):** "The stack-preflight `feature-repair` restack and the routed-exit restack refuse and halt `needs-human`, naming the child…"
**Story opposing sentence (verbatim, before resolution):** "…then it halts `needs-human` with reason `unlanded-closed-child-commits`, naming child 1 and `ai-conductor stack land --slug demo --child 1 --reason "<why>"`, and runs no restack."
**Resolution:** The publication check runs first, so a published stack keeps the shipped
`published-stack` halt. Changes made:
- #3203 ADR decision 8 and Story 7 (a new negative criterion);
- a #3203 note on publication decision 11.

## Degrading (resolved)

| # | Conflict | Resolution |
|---|---|---|
| C3 | Retiring automatic close-over and co-origins contradicts shipped stories and three ADR passages | Shipped criteria scoped in place to routing off or to a carrying operator round (#2943 Story 9, #2942 Stories 1 and 12, #2944 Story 7, #3212 Stories 3 and 7); #3203 notes on per-child decision 2, routed decision 14 and routed assumption A2 |
| C4 | Closed-child rewind restages to `pending`; rewind D2 requires `stale` | #3203 note on rewind D2; ADR decision 11 states `pending` |
| C5 | `adr-2026-10-03` decision 13 still refuses closed children and demotes children above | #3203 note on decision 13; a closed child is validated by its closure ref; Story 10 gains the recreated-worktree criterion |
| C6 | ADR decision 6 said host commits need no `Round:` stamp; routed decision 5 depends on it | Decision 6 reworded: host stamping is unchanged |
| C7 | Routed decision 13's no-commit cases and no-op escalation D1 omit operator rounds | The #3203 note on routed decision 13 is extended; #3203 note on no-op escalation D1; decision 1's table gains the guard row |
| C8 | The verify-green precondition refused children with no owned criteria | A vacuous contract for no-criteria children, matching #3211 Story 3; A5 corrected |
| C9 | The open-time cascade-cap refusal printed a recovery that cannot succeed | The check was dropped; the exit's shipped cap halt records the evidence `raise` needs |
| C10 | The undeclared halt vs #3210 Story 6's "defer and continue" | Story 6 keeps the re-kick request and emits no deferral; #3210 Story 6 is scoped to `audit` and `revalidate` rounds |
| C11 | Story 14's event order disagreed with the marker transaction | Story 14 reordered |
| C12 | "Every operator command acquires the lease" was broader than the stories | ADR decision 2 narrowed to the four new commands |
| C13 | The printed command's shape differed between ADR and story | `--slug` added to ADR decisions 5 and 8 |
| C14 | Depends on #3365, which is not yet on the base | A native blocked-by link to #3365 is added at land; merge main and re-verify the loader claims when #3365 lands |

Defects inside this spec, also fixed:
- `--abandon` clears every operator halt naming its round;
- `--done` requires a commit that changes more than the halt record;
- `--adopt` is renamed `--carry`, so it does not collide with #3268's `stack adopt`.

## Pairs judged compatible

- `#3210` Stories 5 and 6 (prepared-record deletion; an admitted host runs no restack).
- `#3211` Story 2 (stamping and the membership hook, a different hook from the guard).
- `#3211` Stories 7 and 8 (base and credit; reroute, which operator rounds disable).
- `#3212` Stories 2, 5, 6, 8, 10 and 11.
- `#2944` Stories 6, 15 and 16.
- `#3365` Stories 3 and 4.
- `#2945` Story 11.
- `#2103` Stories 1–12.
- The daemon lifecycle restart stories.
- `#2190` Stories 2, 5 and 7.
- The operator-park provenance story.
- The engine-invoked task-attribution story.
- `#2940` Story 7 and `#2132`, for open-child rewind.

## ADRs examined

**Compatible:**
- `adr-2026-07-13-park-all-dispatch-paths`
- `adr-2026-07-04-park-unpark-cli-verbs`
- `adr-2026-07-10-park-marker-main-root-resolution`
- `adr-2026-08-29-operator-authorized-kickback-budget-recovery`
- `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever`
- `adr-2026-09-11-immutable-state-lease-recovery-succession`
- `adr-010-pidfile-lock-daemon-liveness`
- `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic`
- `adr-2026-08-23-committed-halt-record`
- `adr-2026-07-28-total-halt-classification-legacy-boundary`
- `adr-2026-09-20-halt-resolution-queue-derived-from-markers`
- `adr-2026-09-20-operator-launched-sessions-retain-conductor-authority`
- `adr-2026-10-01-daemon-session-command-contracts` (the skill's command regions are operator-only)
- `adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts`
- `adr-2026-07-22-phase-scoped-docs-write-guard`
- `adr-2026-08-01-conduct-state-mutation-port`
- `adr-2026-07-01-machine-scoped-operator-identity`
- `adr-2026-10-14-ac-prefixed-skill-names`
- `adr-2026-07-26-event-sink-registry-exhaustiveness` (`operator_round` needs an `EVENT_SINKS` entry)
- `adr-2026-10-15-per-dispatch-engine-pinned-executor`
- `adr-2026-08-27-daemon-dispatcher-executor-seam`
- `adr-2026-10-14-dispatch-first-daemon-maintenance`
- `adr-2026-07-27-ancestry-proven-park-reconciliation`
- `adr-2026-08-01-multi-proof-park-deletion-authority`
- `adr-2026-08-06-honest-park-termination-boundary`

**In conflict, now resolved by amendment notes:**
- `adr-2026-10-17-stacked-feature-publication-as-native-stack`
- `adr-2026-08-19-operator-step-rewind-through-the-mutation-port`
- `adr-2026-10-03-stacked-child-plans-identity-and-state`
- `adr-2026-10-12-routed-whole-feature-repair`
- `adr-2026-07-13-kickback-build-no-op-escalation`
- `adr-2026-10-07-per-child-build-region`
- `adr-2026-10-10-stacked-restack-journaled-replay`

**Resolved in the #3203 ADR only:** `adr-2026-07-29-operator-park-scheduling-unit-boundary`.

**Prerequisite:** `adr-2026-10-23-slice-topology-from-sealed-plan`.

**Narrowed out:**
- `adr-2026-07-04-operator-park-marker` (superseded by `adr-2026-07-29`);
- `adr-2026-07-22-heartbeat-lease-deferred` (intake claims);
- `adr-2026-09-29-plan-slice-manifest` and
  `adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility` (plan authoring);
- the rebase-resolution, halt-PR, finish-publication, release-gate, intake-claim, cost and
  provider-session ADRs, which do not overlap this change.
