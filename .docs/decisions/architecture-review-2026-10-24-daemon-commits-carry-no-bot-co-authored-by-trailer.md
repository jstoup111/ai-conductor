# Architecture Review: Daemon commits carry no bot co-author trailer under child isolation
**Date:** 2026-10-24
**Inputs reviewed:** explore outcome in `.docs/track/daemon-commits-carry-no-bot-co-authored-by-trailer.md` (technical track, Balanced scope, approach C), intake jstoup111/ai-conductor#3377, and the operator-approved diagram `.docs/architecture/daemon-commits-carry-no-bot-co-authored-by-trailer.md`
**Verdict:** APPROVED
**Mode:** Lightweight (Tier M): Feasibility and Alignment only

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | No new packages, services, or config keys. The design reuses `createBotCoAuthorResolver`, `installDaemonBotCoAuthor`, `makeProductionGh`, and the existing `bot_co_author_skipped` variant. |
| Prerequisites | None. #2839 shipped the resolver, hook stamp, and engine commit helper; #3306 made `executor_isolation: child` the default. |
| Integration surface | Two entry points (the supervisor in `daemon-cli.ts`, the private `executor-child` branch in `index.ts`), one new bootstrap module, `refreshWorktreeCoAuthor` in `engine/bot-co-author.ts`, the closed reason union in `types/events.ts`, its `daemon.log` rendering, and the wiring test. All are engine-internal. |
| Data implications | One closed reason added to an existing persisted event variant. Readers that switch on the reason (`formatBotCoAuthorSkipped`) must handle it exhaustively. No migration and no schema file. |
| Performance risk | One `GET /user` per executor child, so one per dispatch instead of one per daemon. A dispatch lasts minutes to hours, so the extra read is negligible. |
| Worktree isolation | Unchanged. The co-author value stays under the worktree's gitignored `.pipeline/`. |

Verified claims:
- [verified] The executor child never installs a resolver. `installDaemonBotCoAuthor(` has exactly one production call (`daemon-cli.ts`, `runDaemonMode`), and `daemon-bot-co-author-wiring.test.ts` pins that single call site.
- [verified] The child prepares worktrees with `dispatchStart: true` (`executor-child-runtime.ts` `prepareWorktree` and `runSetupTriage`), and `prepareWorktree` calls `refreshWorktreeCoAuthor`, which silently does nothing when no resolver is installed.
- [verified] The child's feature event bus persists to the worktree `.pipeline/events.jsonl` and forwards every event over IPC to the supervisor (`executor-child.ts`, the per-order `ConductorEventEmitter` with its `EventPersister` and `port.send({ kind: 'event' })` loop). The supervisor renders `bot_co_author_skipped` into `daemon.log` (`daemon-cli.ts`). A resolver bound to that bus therefore delivers skip events to the spine and to `daemon.log`.
- [verified] `dispatchStart: true` is passed only on daemon paths: `daemon-deps.ts` `makeFeatureRunnerDeps` (used by `daemon-cli.ts` and the child entry in `index.ts`), the resume deps in `daemon-cli.ts`, and the two child-runtime calls. No operator-run CLI passes it, so gating the absent-resolver skip on `dispatchStart` keeps operator runs silent.
- [verified] Executor-child GitHub calls are not brokered to the supervisor. `withExecutorBrokerProxies` proxies only rate limits, provider availability, the live boundary, and the worktree lifecycle. The child calls `makeProductionGh()` directly, and that function already reads the bot credential and token (`pr-labels.ts`). The child is therefore already a holder of the bot credential.
- [inferred, ~90%] The executor child can read `~/.ai-conductor/config.yml` and the bot token file, because it already reads `~/.ai-conductor/plugins` and loads config at startup. If it is wrong, the resolver emits `token-unavailable`. That fails visibly, so the assumption does not change the design.
- [inferred, ~90%] Under `executor_isolation: in-process`, the supervisor's installed resolver serves dispatch preparation, because that preparation runs in the supervisor process. A story criterion pins this with a test rather than relying on the inference.

## Alignment

- **Governing ADR reused and amended, not duplicated.** adr-2026-09-11-github-operation-ownership D10 owns bot co-author attribution. This feature restores D10.3's scope under child isolation. Only D10.1's cache scope changes (per daemon or executor process), and D10.6 gains a closed reason. Both are recorded as an additive amendment note beside D10. No new ADR: the bootstrap seam is a composition detail inside an existing component and does not change a system boundary, decomposition, integration pattern, state architecture, or foundational technology.
- **adr-2026-10-15-per-dispatch-engine-pinned-executor** keeps every root mutation in the supervisor. Installing an in-memory resolver in the child and writing the worktree's own `.pipeline/co-author` are not root mutations, so the boundary is respected.
- **Event spine.** The absent-resolver skip is an occurrence. It joins the existing closed `bot_co_author_skipped` variant as a new reason, uses the existing `EVENT_SINKS` routing (render and persist), and adds no new channel.
- **State.** The reason union stays closed, and `formatBotCoAuthorSkipped` stays an exhaustive switch with no default branch.
- **Security boundaries.** No new credential holder (see the verified claim above). The event carries no token, path, or stderr (D10.6, D10.7).
- **Production DI defaults.** The resolver cache stays process-lifetime memory, as D10.1 intends. No stateful store is involved.
- **Diagram accuracy.** `.docs/architecture/daemon-commits-carry-no-bot-co-authored-by-trailer.md` (operator-approved 2026-10-24) matches this design.
- **Focused local pattern basis: daemon-only process wiring.**
  - *Role:* the precedent for wiring a per-process daemon service is the existing `installDaemonBotCoAuthor(createBotCoAuthorResolver({ runner: makeProductionGh(), cwd: projectRoot, events }))` call in `runDaemonMode` (`daemon-cli.ts`).
  - *Traits to preserve:* the service is installed once per process, before any dispatch work, from a daemon entry point only, bound to that process's event bus. Operator-facing entry points never install it, and a static wiring test pins both facts.
  - *Why it applies:* the executor child is a second daemon entry point with the same lifecycle obligation.
  - *Allowed variation:* the install moves behind one bootstrap function, and the child passes its per-order feature bus rather than a daemon-wide bus, because the child runs exactly one order.
  - *Rediscovery hints:* `installDaemonBotCoAuthor`, `runDaemonMode`, `dispatchCliCommand`'s `executor-child` branch in `index.ts`, and `daemon-bot-co-author-wiring.test.ts`.

## Wiring Surface

| New or changed surface | Called from in production |
|---|---|
| Daemon-process bootstrap (new engine module) | `runDaemonMode` in `daemon-cli.ts`, replacing the inline resolver install; and the `run` callback of the `executor-child` branch in `index.ts`, before `runExecutorChildFeature`, with that order's feature event bus |
| Closed `bot_co_author_skipped` reason for an absent resolver at dispatch | Emitted by `refreshWorktreeCoAuthor` when `prepareWorktree` runs with `dispatchStart` and no resolver is installed; rendered by the existing `daemon.log` case through `formatBotCoAuthorSkipped` |
| Updated wiring test | Pins that both daemon entry points call the bootstrap and that no operator-run entry point does |

Advisory `ai-conductor overlap-scan` over `bot-co-author.ts`, `index.ts`, `daemon-cli.ts`, `types/events.ts`, `worktree-prepare.ts`, and the wiring test: textual overlap only in the shared hotspots `daemon-cli.ts` (spec/daemon-log-flooded-with-raw-claude-stream-json-and, spec/self-host-phase6-wiring) and `types/events.ts` (spec/daemon-repair-queue-and-maintenance-events-admit-i). None touches the co-author surface. Open PR #3389 also edits `types/events.ts` but not this variant.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A third daemon process type is added later and forgets the bootstrap | Technical | Low | Medium | The absent-resolver skip makes the miss visible at the first dispatch, and the wiring test enumerates daemon entry points. |
| The absent-resolver skip fires on an operator run | Technical | Low | Low | Gate on `dispatchStart`, which is verified daemon-only. A test asserts that operator preparation without `dispatchStart` emits nothing. |
| A child-path test passes in-process but not in the real child (#2839's gap) | Technical | Medium | Medium | Acceptance requires a test that drives the `executor-child` entry composition, not only `refreshWorktreeCoAuthor` with an injected resolver. |
| #3333 removes `in-process` mid-flight | Integration | Medium | Low | The bootstrap covers both entry points. If in-process is later retired, its call site simply goes away. |

## ADRs Created

None. Amended: adr-2026-09-11-github-operation-ownership (additive note beside D10: per-process cache scope, the shared bootstrap, and the absent-resolver reason).

## Conditions

None.
