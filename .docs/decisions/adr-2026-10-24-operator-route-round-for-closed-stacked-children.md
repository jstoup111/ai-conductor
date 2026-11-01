# ADR: Manual changes and rewinds of closed stacked children run as an operator route round

**Date:** 2026-10-24
**Status:** APPROVED
**Deciders:** operator (James Stoup), composer session for #3203, with adversarial review (Claude ×1,
Codex ×1)

## Context

#3203 was split from #2944 by operator decision (2026-10-12). It owns the manual landing aid and
the closed-child rewind on top of the routed-repair machinery of
`adr-2026-10-12-routed-whole-feature-repair`, which shipped with #2944, #3210, #3211 and #3212.
Diagrams: `.docs/architecture/manual-reviewer-edits-cannot-be-landed-safely-in-t.md`.

The operator decided during DECIDE (2026-10-24):
- only unpublished stacks; a published stack refuses and names #3268;
- a raw commit past a closed child's closure, made outside a landing, halts instead of being closed
  over, and can be carried into a landing;
- the landing CLI parks the feature itself and releases only a park it took;
- a durable per-feature dispatch lease, with process liveness, excludes the daemon and every other
  writer while an operator command mutates the feature.

It builds on #3365 (`adr-2026-10-23-slice-topology-from-sealed-plan`): slice topology comes from
`loadSliceTopology`, and the cursor's unresolvable kind is `topology-unavailable`.

Verified facts at the spec base (paths relative to `src/conductor/src/engine/`):
- **Two route kinds, mostly non-exhaustive tests.** `RouteKind = 'audit' | 'revalidate'`
  (`routing/route-types.ts`). Only `restageHostRegion` (`routing/host-region-entry.ts`) switches
  exhaustively. These are `===` tests that would silently treat a new kind as an old one:
  - the revalidate pin and the audit derived-already-complete check in `enterHostRegion`;
  - receipt settlement (`routing/round-receipt.ts`);
  - the queue close rule (`routing/revalidation-queue.ts`);
  - the `build_review` base (`child-cursor.ts` `resolveChildBase`);
  - the revalidating-source check in `conductor.ts`.

  The prerequisite-claim gate tests the execution source (`routed-host`), not the kind
  (`conductor.ts`).
- **A closed host halts on entry when it has no new task work.** An `audit` round runs
  `checkStepCompletion('build')` at host entry. That predicate (`artifacts.ts`) reads task status,
  `Task:` trailers and open obligations, never new commits, so a closed child reports done and
  the conductor halts `derived-already-complete`.
- **Resume enters a host at `build`.** `reconcileRounds` returns `navigate-leaf-to-build` for an
  `admitted` or `repairing` host, and the conductor navigates the leaf back to `build`, skipping
  overlay index derivation (`conductor.ts`, `routedLeafBuildResume`). The post-exit paths set the
  loop index to `acceptance_specs` explicitly.
- **Region entry happens before the park check,** and the routed exit after `build_review` has no
  park check at all (`enterRoutedHostRegion` runs before `stopAtOperatorParkBoundary`).
- **Nothing reliably reports running engine work.** `classifyRunningWork` (`daemon-dashboard.ts`)
  folds only `provider_attempt` events. Preflight, worktree prepare, region entry, `test_suite`,
  verify-green, a restack or the routed exit all read as `stopped`. A park takes effect only at the
  next park boundary. No durable dispatch lease exists; claims are in memory (`work-claims.ts`).
  The liveness precedents are `RestackJournalOwner {host, pid, processStartTime}` with
  `isJournalOwnerAlive` (`restack/restack-journal.ts`), and `createConductStateLease`
  (`conduct-state-lease.ts`), a directory lease with an owner record and a recovery claim.
- **Park is a file whose creation reports no ownership.** `.daemon/parked/<slug>` is created with
  `wx`; a lost race returns success (`park-marker.ts`).
- **The preflight closes over raw commits, and a marker makes them co-origins.** With no marker, a
  non-halt commit past a closed child's closure gives `repair-pending`, and `runStackPreflight`
  runs the automatic `feature-repair` restack (`restack/stack-preflight.ts`). With a marker, any
  closed non-host child whose post-closure commits are all unstamped becomes a co-origin
  (`child-cursor.ts`), and `requestRoutedExit` restacks it with the host (`routing/routed-exit.ts`).
- **A live HALT stops the preflight.** `runStackPreflight` returns `halted` on any HALT without a
  matching resume authorization. A due base refresh with an open round returns before
  `reconcileRounds`.
- **Commit hooks are per worktree** (`wireGitHooks`, `worktree-prepare.ts`: `core.hooksPath` is
  `<worktree>/.pipeline/git-hooks`). They are written only at worktree preparation.
  - `--no-verify` skips pre-commit and commit-msg, but not prepare-commit-msg.
  - Pre-commit returns early on `CONDUCT_ENGINE_COMMIT=1`, and again unless `.pipeline/phase-active`
    is BUILD or SHIP.
  - prepare-commit-msg stamps `Round:` on host commits through `round-stamp`, except for amends,
    rebases and empty commits.
  - A daemon session carries `CONDUCT_DAEMON_SESSION=1` (`execution/daemon-session.ts`).
- **A prerequisite claim can reset round-stamped work.** `rerouteRound`
  (`routing/prerequisite-claim.ts`) accepts commits stamped with the round's id, then
  compare-and-swaps the source branch back to its closure.
- **Rewind refuses a closed child** that is not the execution child, naming #3203 (`rewind.ts`).
  - It needs a live HALT.
  - For an open child it demotes every child above.
  - Its commander declaration lacks `--child`.
  - `adr-2026-08-19-operator-step-rewind-through-the-mutation-port` D1 and D3 govern it.
- **`returnToLeaf` always re-pends the leaf gates** (`restageLeafGates`, `routing/routed-exit.ts`)
  and does not delete the marker.
- **The branch-reset primitives exist.**
  - `writeRoutingTransaction` has `create-pin` and `update-branch` ops
    (`routing/route-record-store.ts`).
  - `syncRestackedWorktree` (`restack/restack-sync.ts`) runs `read-tree -m -u` from explicit old and
    new tips.
  - Reroute recovery persists those tips before the sync.
- **The build work order is persisted but never read back.** `admitRoutedTasklessKickback` writes
  `allocation[host].retryHint`; dispatch reads only the in-memory `pendingRetryHints`.
- **`build_review` on a routed host takes no task list.** It grades `pinnedBase..HEAD` against the
  plan body, the stories and `repairContext` (`build-review-inputs.ts`).
- **The re-validation queue is selective.** It queues a moved closed child only for gates whose
  inputs changed (`restack/restack-transition.ts`). `test_suite` is never preserved by replay
  identity alone (routed decision 14). That is the guarantee #2944 gives routed fixes.

## Options Considered

### Option A: An operator round on the routed-repair machinery (chosen)
- **Pros:**
  - One state machine. The marker, pinned base, exit restack, re-validation queue, leaf gates and
    crash recovery all apply.
  - The new parts are the entry points, the exclusion, the guards and a declaration.
- **Cons:**
  - A third kind at every branch point.
  - A round that stays open while a human edits, which no shipped round does.
  - A new dispatch lease.

### Option B: Transplant a finished change onto the child
- **Pros:** no long-lived open round.
- **Cons:**
  - The change is developed against code the child does not contain.
  - It is close to the routed ADR's rejected Option C.
  - It does not cover the closed-child rewind.

### Option C: Guards only
- **Pros:** smallest.
- **Cons:** no point where the change is declared complete, so a half-built change can still be
  closed over, and branches are still edited by hand.

## Decision

Option A.

1. **A third route kind, `operator`, with origin `land` or `rewind`.**
   - **Host.** An operator round has exactly one host `k`, a closed child below the leaf.
   - **The `operator` section.** It is written into the record at `prepared`, before any mutation:
     - `origin`, `reason` and `operator` (from `resolveMachineOperatorIdentity`);
     - `entryStep`: `acceptance_specs` for `land`, the `--to` step for `rewind`;
     - `park` (decision 3);
     - `carried`: closed children above `k` whose existing post-closure commits the round carries,
       each with its tip (decision 8);
     - `otherTips`: every other branch of the feature (children and leaf) at admission;
     - `priorRegion`: `k`'s region step statuses and the contents of its region verdict files;
     - `declaration {tip, at}`, absent until declared;
     - `abandon`, absent until abandoning (decision 13).
   - **Parsing.** The parser fails closed on an `operator` record without the section, and on the
     section in a record of another kind. `sealedAuthored` is set from `routedSealedAuthored`, as
     `audit` rounds set it, so receipt rebuilding stays readable.
   - **Exhaustive switches.** Every kind test, and the prerequisite-claim gate, becomes an
     exhaustive switch ending in `assertNever`. For `operator`:

     | Branch point | `operator` behaviour |
     |---|---|
     | `restageHostRegion` | `land`: `acceptance_specs`, `test_suite`, `build_review` pending, `build` left done; `rewind`: `k`'s region from `entryStep` onward pending |
     | revalidate queue pin | none |
     | derived-already-complete check | skipped; the declaration is the evidence |
     | route-into-no-op guard at host entry | skipped; a `land` round's change is already committed, and a `rewind` re-runs gates |
     | prerequisite claim | disabled, so no reroute can move or reset the change |
     | receipt settlement | acknowledged without settlement, as `revalidate` |
     | queue close rule | as `audit` |
     | `build_review` base | `routed-repair`, the pinned closure |
     | revalidating-source check | not a revalidating source |
     | `remediation_routed.kind` | `operator` |

2. **A durable feature dispatch lease excludes every other writer.**
   - **Location.** The lease lives under `.daemon/leases/<slug>/` in the repository root, so every
     worktree sees it. It uses `createConductStateLease`'s directory-lease shape.
   - **Owner record.** `{host, pid, processStartTime, token, purpose}`. Liveness follows
     `isJournalOwnerAlive`: the pid exists and its start time matches. A dead owner's lease is
     reclaimed through the lease's recovery claim.
   - **Daemon dispatch.** Daemon dispatch and the daemon re-kick acquire the lease before their
     first mutation, including worktree preparation and the re-kick sweep's rebase abort and
     marker clear. They re-check the operator park after
     acquiring, and hold the lease until the unit ends. A daemon dispatch that cannot acquire it, or
     finds the feature parked after acquiring, skips the unit without a halt.
   - **Interactive conductor runs.** An interactive conductor run on a stacked feature acquires the
     lease the same way, but does not re-check the park. Boundary parking stays daemon-only
     (`adr-2026-07-29-operator-park-scheduling-unit-boundary` D2). An interactive run that meets an
     undeclared landing is stopped by decision 10 at resume. One that cannot acquire the lease
     refuses to start and names the owner.
   - **Operator commands.** The four commands this decision adds (`stack land`, `--done`,
     `--abandon` and the closed-child `rewind`) acquire the lease and hold it for their whole
     mutation. Other operator commands are unchanged. A live owner refuses, naming its purpose and pid. An unknown or unreadable owner
     refuses rather than guessing. `classifyRunningWork` is no longer a precondition.
   - **N=1.** On a feature without durable child state, no lease is read or written.

3. **`stack land` takes an owned park, proven by a token.**
   - Park creation gains an ownership result: the marker is created with `wx` holding a fresh token,
     and the caller learns whether it created it.
   - The record stores `park {token}` only when this round created the marker.
   - Release deletes the marker only while it still carries that token. An operator's earlier park,
     a park re-created by someone else, or a lost race is never removed.
   - A crash between parking and the `prepared` record leaves the feature parked, which fails
     toward safety.

4. **Each command has its own precondition predicate, with a closed refusal set.** Every refusal
   names its cause and the next command. All four are refused inside a daemon session, because
   they are not in `SESSION_SANCTIONED_SUBCOMMANDS`. They need no TTY, so an interactive agent can
   run them. That departs from `kickback-budget-cli`'s TTY guard; the record keeps the machine
   operator's identity instead.
   - **Open** (`stack land`):
     - durable child state, and a cursor that resolves (`topology-unavailable` refuses with the
       #3365 cause);
     - the routing setting is on;
     - no active publication record, naming #3268;

       > **Amended 2026-11-01 by #3269:** `stack land` now opens on an active publication record when every member's remote tip equals its pushed receipt and no member has a recorded `lastSeen`; otherwise it refuses, naming the member and #3268. `rewind --child` still refuses on a published stack (`adr-2026-11-01-routed-fix-refreshes-a-published-stack` decisions 1 and 10).

     - `k` is closed and below the leaf;
     - `k` has a verify-green contract: its `red/c<k>` blob, its
       `children/<k>/acceptance-specs-run.json`, or no owned acceptance criteria at all, in which case
       verify-green is vacuous, as a routed pass already treats it;
     - every other closed child with non-halt post-closure commits is listed in `--carry` and sits
       above `k`;
     - no marker, no non-closed round, an empty queue, and a terminal journal;
     - a clean worktree;
     - a non-empty reason.
   - Cascade headroom is not checked at open. A capped exit restack halts with the shipped
     cascade-cap halt, which records the evidence `kickback-budget raise --gate restack` needs.
   - **Resume.** A non-closed operator round for the same `k` resumes its unfinished admission
     stages instead of refusing.
   - **Declare** (`--done`): decision 9.
   - **Abandon** (`--abandon`): decision 13. It needs only the round's own recorded authority, so a
     defect elsewhere in the stack never blocks it.
   - **Rewind:** decision 11.

5. **`stack land --slug <slug> --child <k> [--carry <j>…] --reason <text>` opens the round through a CLI-only
   entry.** Under the lease, in order:
   1. park (decision 3);
   2. the `prepared` record with the full `operator` section;
   3. refresh the feature worktree's hooks (`writeGitHooksAndWire`), so the guard is installed
      before the first edit;
   4. the shipped marker transaction: marker `{host k, roundId}`, host `admitted`, round `open`,
      and `remediation_routed` plus `operator_round opened` in the outbox;
   5. `openOperatorRound` pins the host `entry` (`{host, pinnedBase: closure, tree}`), switches the
      worktree to `feat/c<k>/<slug>` through `switchToChild`, and runs `restageHostRegion`. It
      moves the host to `repairing` and grants the round's `routedRepairCredit`. It calls the same
      pin and restage helpers as `enterHostRegion`, but is not `enterHostRegion`;
   6. clear a HALT it resolves (decision 10);
   7. release the lease. The park stays.

   - **Existing host commits.** Commits already past `k`'s closure are taken into the round. The pinned base is the closure,
     so they are graded with the rest of the change.
   - **Resume.** Each stage is idempotent and recorded, so re-running the command after a crash
     resumes at the first unfinished stage. A `prepared` record with no marker is still deleted by
     `reconcileRounds`, as today.

6. **A commit guard refuses commits on every branch but the host, in every round kind.**
   - **Where.** A blocking `stack-commit-guard` step in pre-commit, after the
     `CONDUCT_ENGINE_COMMIT` bypass and before the `phase-active` early return, so it applies in
     every phase. It is added to `SESSION_SANCTIONED_SUBCOMMANDS`.
   - **N=1.** It abstains, with no routing read, when the branch is not a branch of a feature with
     durable child state.
   - **With any marker present:**
     - it refuses a commit on any branch of the feature other than the marker's host, with or
       without a `Task:` trailer, in `audit`, `revalidate` and `operator` rounds alike;
     - the only exception is a commit whose staged paths are all `.docs/halted/<slug>.md`;
     - the refusal names the host branch and, for an operator round, `stack land --abandon`.
   - **After an operator round is declared,** it also refuses commits on the host outside a daemon
     session (`CONDUCT_DAEMON_SESSION`). Every host commit after `--done` is therefore made by the
     region's own repair and graded by its `build_review`.
   - **Fail closed.** A marker that is present but whose record cannot be read refuses.
   - **Stamps.** Host `Round:` stamping is unchanged. It stays the evidence the reroute check reads
     in `audit` rounds (routed decision 5). Operator rounds disable reroute (decision 1), so they do
     not rely on it.

7. **Branch tips are checked mechanically wherever the hook cannot see.**
   - While an operator host is `admitted` or `repairing`, every `otherTips` branch must be at its
     recorded tip, or carry only halt-record-only commits past it, and every `carried` child must be
     at its recorded tip.
   - This is checked at `--done` (refuse) and in the preflight (halt, reason
     `operator-round-branch-moved`, naming the branches). In the preflight it runs before the
     undeclared-round check, so a moved branch is reported even on an undeclared round.
   - It is never checked once the host is `built`, `restacked`, `done` or `abandoned`, because the
     exit restack moves those branches legitimately.

8. **No closed-child commit is closed over unless a round carried it.** With routing eligible:
   - The automatic `feature-repair` restack for a `repair-pending` cursor with no marker is retired.
     The preflight halts needs-human with reason `unlanded-closed-child-commits`. The halt prints
     the exact command:
     `ai-conductor stack land --slug <slug> --child <lowest> [--carry <others>…] --reason "<why>"`.
   - **Publication first.** The published-stack check runs before this one. A published stack with
     post-closure commits keeps the shipped `published-stack` halt naming the child, plus #3268
     (`adr-2026-10-17-stacked-feature-publication-as-native-stack` decision 11). It is never told to
     run a `stack land` that would refuse.

     > **Amended 2026-11-01 by #3269:** When the tip preflight passes, this halt now names `stack land` as the recovery, because a landing on a published stack is allowed (`adr-2026-11-01-routed-fix-refreshes-a-published-stack` decision 1). A failed preflight keeps naming #3268.

   - The automatic co-origin is retired for every kind. A closed non-host child with unstamped
     post-closure commits is a co-origin only when it is in the open operator round's `carried`
     list. `requestRoutedExit` halts with the same reason when the cursor reports any other
     co-origin, and runs no restack.
   - **Carried children** originate the exit restack with the host. Their tips were recorded at
     admission, and the restack queues them for re-validation like any other moved closed child.
     The person declares them complete with the host at `--done`.
   - Halt-record-only commits still trigger nothing. With routing off, today's automatic restack is
     unchanged.

9. **`stack land --done` declares the change complete.**
   - **Preconditions, under the lease:**
     - the round is an undeclared `land` round;
     - the worktree is on the host branch and clean;
     - the host branch has at least one commit past its closure that changes more than the halt
       record; otherwise it refuses and names `--abandon`;
     - decision 7's tip check passes;
     - the journal is terminal.
   - **Effect.** One routing transaction does three things:
     - records `declaration {tip, at}`;
     - writes the reason into `allocation[k].retryHint`;
     - adds `operator_round declared` to the outbox.

     It then clears a HALT it resolves (decision 10), releases the lease and an owned park, and
     prints the next step.
   - **Navigation.** `reconcileRounds` returns a navigate result carrying the record's `entryStep`.
     The conductor sets the region loop index to that step, as its post-exit paths already do for
     `acceptance_specs`. A landing therefore starts at verify-green.
   - **What then runs, shipped machinery:**
     - acceptance in verify-green mode;
     - `test_suite`;
     - `build_review` against the `routed-repair` base, with the reason added to its inputs as the
       operator work order, beside `repairContext` and inside the digested source snapshot.

     A failing gate kicks back to `build` inside `k`, under `k`'s caps and the round's
     routed-repair credit. Build dispatch reads `allocation[k].retryHint` back, so the work order
     survives a restart. When the region passes, `requestRoutedExit` restacks from `k` with the
     carried children as co-origins, and the queue and `returnToLeaf` follow.

10. **Operator halts are cleared only by the command that resolves them.**
    - Three reasons are written with HALT class `needs-human` and a machine-readable reason line:
      `operator-round-undeclared`, `unlanded-closed-child-commits` and
      `operator-round-branch-moved`.
    - `stack land` (open or resume) clears an `unlanded-closed-child-commits` HALT whose children
      it carries. `--done` clears `operator-round-undeclared` for its round.
      `operator-round-branch-moved` is cleared, once the branches are back at their recorded tips, by
      `--done` on an undeclared round or by re-running `stack land --child <k>` (resume) on any open
      operator round, declared or not. `--abandon` clears every operator halt naming its round.
    - The reason line has one format, `Operator-Halt: <reason> <roundId>`, written and parsed by one
      helper, so a clearer matches only halts it resolves.
    - Each clear uses rewind's atomic HALT clear. Any other HALT is left in place and reported.
    - **Undeclared rounds.** The stack preflight, conductor resume and daemon re-kick check for an
      undeclared `land` round after both journal recoveries and before the base-refresh deferral
      and `reconcileRounds`' navigate arms, and halt `operator-round-undeclared`. A due re-kick
      request is kept, not consumed, and no `deferred-base-refresh` is emitted, because the halt
      precedes the deferral.
      `enterHostRegion` also refuses an undeclared operator round. That closes the gap where
      region entry runs before the park check. Neither path runs a restack or the routed exit.

11. **`rewind --child <k> --to <step> --reason <text>` on a closed child opens a declared operator
    round.**
    - It replaces the refusal. The existing rewind preflight (a live HALT and `HALT.class`) applies,
      together with decision 4's open predicate (except `--carry`). It runs under the lease and
      takes no park, because the HALT holds dispatch until the rewind clears it.
    - A closed `k` is validated against its closure ref, as `--gate restack` already is, not against
      `.pipeline/children/<k>/`. A rewind after a worktree recreation therefore works. When
      `.pipeline/children/<k>/` is missing, the restage writes `k`'s region state with every step
      before `<step>` done and `<step>` onward pending.
    - The round has origin `rewind`, `entryStep` is `<step>`, and it is declared at creation.
    - The restage sets `k`'s region from `<step>` onward to pending, as routed region entry does,
      not to `stale`. It does not demote the children
      above `k` or the leaf. Those are re-validated by the queue when the exit restack moves them,
      and the leaf gates re-run at `returnToLeaf`, which is the routed guarantee. The HALT is then
      cleared as today.
    - The round leaves through the routed exit. When the host tip still equals its closure, it
      takes the no-commit exit: nothing above `k` changed, so no child above needs re-validation,
      and `returnToLeaf` re-pends the leaf gates. That is a further case of routed decision 13's
      no-commit exit.
    - The commander declaration gains `--child` and `--reason`.

12. **An operator round charges no gate budget.**
    - No gate lap, no growth and no taskless charge. The receipt is empty and is acknowledged
      without settlement.
    - Kickbacks inside `k` spend `k`'s per-child caps and the one `routedRepairCredit`. Those stay
      spent if the round is later abandoned.
    - Each restack charges one cascade on each originating child, as restack ADR decision 10 says.

13. **`stack land --abandon` resets the host through recorded stages.**
    - **Preconditions** (its own predicate, under the lease):
      - an operator round is open, with its host `admitted`, `repairing` or `abandoning`; a `built`
        or later host refuses, because the exit restack has begun;
      - the worktree is clean. For an `abandoning` host, clean means the tree matches the recorded
        `rejectedTip` before the sync, or the reset tip after it, because stage 1 moves the
        checked-out branch ahead of the sync.
      - An `abandoning` host resumes from its recorded stage.

      It takes an owned park. It accepts a host whose history was rewritten past its closure
      (`closed-child-rewritten` for `k` only), because abandoning is the way out of that state.
    - **Stages,** each recorded in `abandon` and replayed on resume:
      1. one transaction: `create-pin` of the tip at `rejected/<roundId>/<k>`, `update-branch` of
         the host to its closure, host state `abandoning`, and
         `abandon {rejectedTip, resetTip, stage: moved}`;
      2. `syncRestackedWorktree(rejectedTip → resetTip)` while on the host branch, then restore
         `priorRegion` statuses and verdict files. Record `stage: synced`;
      3. one transaction: host `abandoned`, marker deleted, `operator_round abandoned` in the outbox;
      4. `returnToLeaf` in its new `abandon` mode, which records the switch and closes the round
         without `restageLeafGates`, because no restack ran;
      5. release the lease and an owned park.
    - **State machine.** `abandoning` is legal only from `admitted` or `repairing`, and `abandoned`
      only from `abandoning`. A closed round counts `abandoned` as terminal. `reconcileRounds`
      resumes an `abandoning` host from its recorded stage, and never re-runs the sync from the leaf.
    - **What survives.** Carried children keep their commits, so the next preflight halts
      `unlanded-closed-child-commits` for them again. The rejected pin keeps the abandoned work
      reachable, and teardown already deletes `rejected/*` by name.

14. **`ai-conductor stack owners` reports mechanically which child introduced a path.**
    - It is read-only and takes no lease. Given `--slug` and `--path …` (or `--diff <range>`), it
      reports, for each path, every child whose own range touched it:
      - parent closure to closure for a closed child;
      - last closure to tip for the leaf.
    - The output is JSON, with positions, branches and titles from `loadSliceTopology`.
    - It reuses the restack range construction and does not judge.

15. **A shipped skill makes the ownership judgement and drives the CLI.**
    - It lives in the shipped `skills/` catalog, under the skill naming rule in force at build time
      (`adr-2026-10-14-ac-prefixed-skill-names`), with metadata for both providers. It is
      operator-invoked.
    - From the requested change it reads `stack owners` and the child titles, then picks the lowest
      child that owns the code being changed, unless the change needs code first present higher up.
      It confirms the choice with the person before running `stack land`.
    - It then guides the commits on the host branch and runs `--done` or `--abandon`.
    - Which child owns a reviewer's request is a judgement call (CLAUDE.md design principle). All the
      bookkeeping stays in the CLI.

16. **Events ride the spine.**
    - One new `ConductorEvent` member: `operator_round {roundId, child, origin, action, reason}`,
      with `action` one of `opened`, `declared` or `abandoned`. It is written to the route-record
      outbox in the transaction it reports, and the persister deduplicates it by `eventId`.
    - Lease refusals and skipped dispatches use existing members (`restack_refused` reasons and the
      daemon's skip logging), extended only by reason values.
    - `daemon status` and the dashboard show an open operator round, its child, and whether it is
      awaiting `--done`, from the existing `routedRepair` cursor field and the record.

17. **N=1 and routing-off parity.**
    - Without durable child state, or with the routing setting off, every new command refuses with
      its cause. The guard abstains before any routing read, no lease is read, and the preflight runs
      today's code.
    - The N=1 golden guard (routed decision 17) still asserts that no routes, `repairing` or
      `revalidate` ref is touched.
    - The new modules join #3365's slice-topology consumer-boundary allowlist.

18. **The guidance changes with the mechanism.**
    - `docs/reference/configuration.md` (Closure), `docs/reference/cli.md` and
      `docs/runbooks/stalled-or-stuck-feature.md` stop telling people to commit to a closed child's
      branch.
    - They document `stack land`, `stack owners`, the closed-child rewind, the dispatch lease and
      the recovery for each new halt reason.

19. **One spec, delivered whole.** The design is estimated at 28–30 plan tasks. The operator
    declined a split on 2026-10-24, so the plan carries a `**Scope-exception:**` naming this decision.
    No flag is added: every decision ships with its production caller in the same spec.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | Calling `writeGitHooksAndWire` from the landing CLI installs the guard in the feature worktree before the first edit | verified | 90% | yes | Wrong-child commits would be caught only at `--done` | — |
| A2 | Setting the region loop index to the record's `entryStep` on the operator navigate arm starts the host region at that step, as the post-exit paths do for `acceptance_specs` | inferred | 85% | yes | The landing would skip verify-green; the plan proves it with a real-`Conductor` integration test | APPROVED by operator 2026-10-24 |
| A3 | A closed host's `build` predicate still reports done after human commits, so the tree-attesting re-check does not re-dispatch a provider build | inferred | 80% | yes | An extra provider build would run before verification, costing a dispatch but not correctness | APPROVED by operator 2026-10-24 |
| A4 | `build_review` with no plan tasks for the host grades the diff against the plan, the stories and the operator work order without failing on an empty task set | inferred | 80% | yes | Every landing would kick back or halt at review | APPROVED by operator 2026-10-24 |
| A5 | A child closed with routing on has a `red/c<k>` blob whenever it owns acceptance criteria, and a child without criteria passes verify-green vacuously, so the precondition refuses only children closed before routing shipped that own criteria and lost their run contract | verified | 90% | yes | Landings on recent children would refuse | — |
| A6 | One routed-repair credit per operator round is enough for a reviewer-sized change | inferred | 80% | yes | Landings would cap out at `build_review` more often and halt needs-human | APPROVED by operator 2026-10-24 |
| A7 | Every dispatch path that mutates a stacked feature can acquire the lease before worktree preparation, with no path mutating first | inferred | 80% | yes | A dispatch path missed by the plan would still race an operator command; the plan enumerates the paths with a test per path | APPROVED by operator 2026-10-24 |
| A8 | pid plus process start time, without a heartbeat, is sufficient liveness for a lease held by a daemon or conductor process on one host | inferred | 85% | yes | A hung owner would block operator commands until it is killed | APPROVED by operator 2026-10-24 |

## Consequences

### Positive
- A reviewer's request lands in the child that owns it, is graded there, and carries up the stack
  with the routed guarantees.
- Wrong-child commits are refused at commit time in every round kind. Bypassed commits are caught by
  the tip check.
- No closed-child commit is restacked unless a round carried it and its author declared it complete.
- A closed child can be rewound.
- Operator commands and dispatches can no longer interleave on one feature.

### Negative
- One more route kind at every branch point, a round that stays open across human time, and a new
  durable lease on every stacked dispatch.
- With routing on, two documented behaviours become halts that must be carried: committing to a
  closed child's branch, and automatic co-origins.
- A child closed before routing shipped that owns acceptance criteria, and whose worktree lost its
  acceptance run contract, cannot be landed on, because it has no verify-green contract.
- Published stacks still have no landing until #3268.

### Follow-up Actions
- [ ] #3268: landing on a published stack, which needs refresh and adoption of the published members.
- [ ] #3269: a comment on a published child PR that received a landing.

## Amendments made by this decision

- `adr-2026-10-12-routed-whole-feature-repair`: decisions 1, 5, 6, 7, 8, 10, 12, 13, 14, 15, and
  assumption A2.
- `adr-2026-10-10-stacked-restack-journaled-replay`: decision 9.
- `adr-2026-10-07-per-child-build-region`: decisions 2, 11.
- `adr-2026-08-19-operator-step-rewind-through-the-mutation-port`: D1, D2, D3, D4.
- `adr-2026-10-03-stacked-child-plans-identity-and-state`: decision 13.
- `adr-2026-07-13-kickback-build-no-op-escalation`: decision 1.
- `adr-2026-10-17-stacked-feature-publication-as-native-stack`: decision 11.
