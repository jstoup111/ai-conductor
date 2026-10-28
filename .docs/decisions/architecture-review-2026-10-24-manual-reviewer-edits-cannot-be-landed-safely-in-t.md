# Architecture Review: Land manual changes in the stacked child that owns them, and rewind closed children

**Date:** 2026-10-24
**Inputs reviewed:** explore output and track marker
(`.docs/track/manual-reviewer-edits-cannot-be-landed-safely-in-t.md`), complexity assessment (Tier L),
the approved architecture diagram (`.docs/architecture/manual-reviewer-edits-cannot-be-landed-safely-in-t.md`),
intake jstoup111/ai-conductor#3203, the in-flight #3365 plan, and four source traces:
- routed-repair as built;
- rewind, park and publication;
- the taskless host region;
- hooks, branch reset and owner attribution.

The ADR draft then had two independent adversarial reviews (Claude and Codex, read-only). Together they
raised 29 findings, 4 of them blocking, and every one was resolved before approval.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack compatibility.** Only existing TypeScript engine modules and git plumbing; no new dependency.
  - The route-record store, its compare-and-swap writer, the marker transaction, the pin and restage
    helpers, `requestRoutedExit`, the queue and `returnToLeaf` all exist (verified).
  - The branch-reset ops (`create-pin`, `update-branch`) and `syncRestackedWorktree` exist, used today
    only by `rerouteRound` (verified).
- **Prerequisites.**
  - **#3365** (`adr-2026-10-23-slice-topology-from-sealed-plan`) must land first. It re-sources the
    cursor, the commit hook, `task-cli` and `rewind` through `loadSliceTopology`, and renames the
    cursor's `envelope-missing` kind to `topology-unavailable`. This spec reads topology only through
    that loader.
  - No migration of persisted data. An older engine fails closed on an `operator` route record,
    because the kind parser rejects unknown kinds (verified).
- **Integration surface.** Wide but inside the engine:
  - the routing modules, the stack preflight and the cursor;
  - the conductor's region loop and resume;
  - daemon dispatch and re-kick (the lease), park, the pre-commit hook body and the session sanction
    list;
  - rewind, the CLI catalog, the skill catalog and the docs.
- **Data implications.**
  - **New durable state:**
    - the `operator` section in route records;
    - two host states (`abandoning`, `abandoned`);
    - the lease directory under `.daemon/leases/<slug>/`;
    - a token inside the park marker.
  - No new git ref: abandoned work uses the existing `rejected/<roundId>/<k>` pin, which teardown
    already deletes by name (verified).
- **Performance.** The commit guard spawns one CLI per commit on stacked branches, as `round-stamp`
  already does. On N=1 branches it abstains before any routing read (inferred, 85%, not load-bearing).
- **Worktree isolation.** No ports or services. The lease and park live under the repository root's
  `.daemon/`, already excluded from the self-host live boundary. Hooks stay per worktree.

## Complexity

High: a third producer on a crash-safe, ref-backed state machine, plus a new durable dispatch lease.
**Split decision (§3a):** the estimate is 28–30 plan tasks. A split was proposed (lease, park and
engine-round guard first; the operator round second), and the operator declined it on 2026-10-24.
The plan carries a `**Scope-exception:**` citing
`adr-2026-10-24-operator-route-round-for-closed-stacked-children` decision 19. No skill directory is
deleted, so the two-feature deletion rule does not apply.

## Alignment

- **Governing ADRs.** `adr-2026-10-24-operator-route-round-for-closed-stacked-children` (new, APPROVED).
  Amendment notes were added on the base branch to:
  - `adr-2026-10-12-routed-whole-feature-repair` decisions 1, 5, 6, 7, 8, 10, 12, 13, 15;
  - `adr-2026-10-10-stacked-restack-journaled-replay` decision 9;
  - `adr-2026-10-07-per-child-build-region` decision 11;
  - `adr-2026-08-19-operator-step-rewind-through-the-mutation-port` D1, D3, D4.

  A scan of every `engineer-*` spec worktree on 2026-10-24 found no competing edit to these four ADRs.
  `adr-2026-10-17-stacked-feature-publication-as-native-stack` decision 11 is cited, not amended: a
  published stack stays frozen, and every new entry point refuses on it.
- **Pattern consistency.**
  - **Operator CLI transaction.** The precedent is `kickback-budget-cli.ts`.
    - Traits to keep: every refusal runs before mutation; a temporary park is recorded as owned and
      released only when complete; operator identity comes from `resolveMachineOperatorIdentity`;
      mutation happens under a lease.
    - Allowed variation: no TTY requirement, so an interactive agent can drive it.
    - Departure: park ownership becomes a token, because the boolean form can remove another caller's
      park.
  - **Liveness.** The precedent is `RestackJournalOwner` with `isJournalOwnerAlive`
    (`restack/restack-journal.ts`), for the pid plus start-time check. The directory-lease shape
    follows `createConductStateLease` (`conduct-state-lease.ts`).
    - Verified no-fit: `otel/spool-lease.ts`. Its heartbeat suits a background spool, not a lease
      held across a dispatch unit.
  - **Branch reset.** The precedent is the reroute transaction in `routing/prerequisite-claim.ts`
    (pin, compare-and-swap reset, recorded tips, then the guarded sync).
    - Departure: abandon records its own stage discriminator, because it ends on the leaf rather than
      on another host.
  - **Hook step.** The precedent is the blocking `task-membership-check` in commit-msg, plus the
    `round-stamp` call shape in prepare-commit-msg (`git-hook-assets.ts`).
    - Traits to keep: a top-level subcommand that is session-sanctioned and reads its project-root env
      var.
    - The guard sits in pre-commit, which already has the staged paths.
- **State management.** The new states are an exhaustively matched kind and explicit host states. The
  declaration is a record field, not a boolean on the host. Every former `===` kind test becomes a
  `switch` with `assertNever`.
- **Event spine.** One new member, `operator_round`, is written through the existing route-record
  outbox and deduplicated by `eventId`. Lease refusals reuse existing members with new reason values.
  No sidecar or second channel (event-spine skill exception C: the record is durable state, not
  telemetry).
- **Security boundaries.**
  - Operator commands are refused inside daemon sessions, because they are not in
    `SESSION_SANCTIONED_SUBCOMMANDS`.
  - The guard is session-sanctioned, because a provider commit runs it.
  - `CONDUCT_ENGINE_COMMIT=1` still bypasses pre-commit. It is not an authority boundary (verified),
    which is why the branch-tip check backs it up.
- **Diagram accuracy.** The approved diagram shows the lease, the CLI stages, the guard, the preflight
  decision, the abandon stages and the rewind round. The project-level docs named in decision 18
  change with the implementation.
- **Scope check.**
  - Audience: consumer-facing. Stacked delivery and `ai-conductor stack land` exist in consumer
    projects through `stacked_prs.enabled`. scope-check's daemon-machinery signal would say
    repo-only; the deciding test (the mechanism exists outside this repo) overrides it.
  - Catalog: shipped `skills/`.
  - Provider: agnostic. The CLI is provider-neutral, and the skill ships with both providers'
    metadata.

## Domain Integrity

- **Semantic types.** The new identifiers are a round id, an origin, a lease token and a park token.
  The plan must model the origin as the `land | rewind` union, and the tokens as branded strings
  produced by their minting functions, never free strings.
- **Parse, don't validate.** The route-record parser is the single validation point for the `operator`
  section. Readers receive the parsed record.
- **Invalid states unrepresentable.** The section exists only on `operator` records. `declaration` is
  absent until declared, and `abandon` until abandoning. Host transitions stay in
  `isLegalHostTransition`, extended with `admitted|repairing → abandoning → abandoned` only.
- **Exhaustive matching.** Required at every kind branch point and at the prerequisite-claim gate.

## Wiring Surface

| New surface | Production caller |
|---|---|
| `ai-conductor stack land` (open, resume, `--done`, `--abandon`) | the commander catalog (`createProgram` in `cli.ts`), with a pre-dispatch detector registered in `PRE_DISPATCH_COMMANDS` |
| `ai-conductor stack owners` | the same catalog; called by the shipped skill |
| `stack-commit-guard` subcommand | the pre-commit hook body written by `writeGitHooks` (`git-hook-assets.ts`), dispatched from `index.ts`, listed in `SESSION_SANCTIONED_SUBCOMMANDS` |
| feature dispatch lease | daemon dispatch (`guardedDispatchWith` in `daemon.ts`, before `daemon-runner.ts` worktree preparation), daemon re-kick (`daemon-rekick.ts`), the interactive conductor run on a stacked feature, and each operator command |
| owned park token | `stack land` and `--abandon`, and `kickback-budget-cli.ts`'s existing temporary park |
| `openOperatorRound` | `stack land` and the closed-child arm of `rewind.ts` |
| operator reconcile arm with `entryStep` navigation | `reconcileRounds`, called by the stack preflight and conductor resume |
| `operator-round-undeclared`, `operator-round-branch-moved` and `unlanded-closed-child-commits` halts | `runStackPreflight` (`restack/stack-preflight.ts`), `enterHostRegion`, `requestRoutedExit` |
| abandon-mode `returnToLeaf` | `stack land --abandon` and `reconcileRounds`' `abandoning` arm |
| operator work order input to `build_review` | `assembleBuildReviewInputs`, plus build dispatch reading `allocation[k].retryHint` |
| `operator_round` event | the route-record outbox, drained by `drainRoutingOutboxes`, persisted by `EventPersister` |
| `rewind --child --reason` declaration | the commander catalog entry for `rewind` |
| shipped skill | the installed skill catalog; operator-invoked |

**Early overlap scan (advisory).** Run over the wiring paths on 2026-10-24:
- unmerged specs touching `conductor.ts`: `planner-escalation-to-architecture-review-halts-as`,
  `run-resolves-another-feature-s-track-marker-when-s`, `daemon-self-host-guardrails`,
  `self-host-phase6-wiring`;
- `daemon-rekick.ts`: `daemon-self-host-guardrails`;
- `routing/prerequisite-claim.ts`: `routed-build-claim-schema-and-parser-disagree-on-t`.

The #3365 build (`multi-child-feature-cannot-resume-after-an-operato`) is not visible to the scan, but
it touches `child-cursor.ts`, `rewind.ts`, `restack/stack-preflight.ts`, `conductor.ts` and the task
hook. It is a declared prerequisite.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A dispatch path mutates a stacked feature before acquiring the lease | Technical | Medium | High | The plan enumerates every dispatch path, with one test per path asserting acquisition before worktree preparation (A7) |
| A hung lease owner blocks operator commands | Technical | Low | Medium | Liveness is pid plus start time; the refusal names the pid so the operator can kill it (A8) |
| The region loop does not start at `entryStep` | Technical | Medium | High | A real-`Conductor` integration test drives a landing from `--done` to the exit restack (A2) |
| A new kind falls through an `===` test | Technical | Medium | High | Every kind test becomes an exhaustive switch, and the TypeScript build fails on a missed arm |
| Retiring automatic close-over surprises operators who commit to closed children | Knowledge | Medium | Medium | The halt prints the exact adopting command, and the docs and runbook change in the same spec |
| An abandon interrupted mid-sync loses local work | Data | Low | High | Recorded stages, a pinned rejected tip, and the guarded sync that refuses overlapping edits |
| Conflicts with #3365 and the overlapping specs in `conductor.ts` | Integration | Medium | Medium | Blocked by #3365; the rest are merged through the normal rebase |

## ADRs Created

- `adr-2026-10-24-operator-route-round-for-closed-stacked-children` — APPROVED by operator 2026-10-24.

## Conditions

1. The spec is blocked by #3365 and reads slice topology only through `loadSliceTopology`. The new
   modules join #3365's slice-topology consumer-boundary allowlist.
2. A2 is proven by a real-`Conductor` integration test: a landing from `--done` reaches verify-green,
   `test_suite`, `build_review`, the exit restack, the queue and the leaf gates.
3. A7 is proven by one test per enumerated dispatch path asserting that the lease is acquired before
   worktree preparation. A dispatch finding the feature parked after acquiring skips without a halt.
4. Every route-kind test, and the prerequisite-claim gate, is an exhaustive switch. A test asserts
   that an operator round never reaches `rerouteRound`.
5. N=1 parity: the golden guard still asserts that no routes, `repairing` or `revalidate` ref is
   touched, and that no lease is read, on a feature without durable child state.
6. The shipped skill passes the integrity suite's catalog checks under the skill naming rule in force
   at build time, with metadata for both providers.
7. The docs and runbook named in ADR decision 18 change in this spec. No document still tells people
   to commit to a closed child's branch.
