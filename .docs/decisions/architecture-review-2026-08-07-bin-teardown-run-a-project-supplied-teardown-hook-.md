# Architecture Review: Project teardown hook before worktree removal

**Date:** 2026-08-07
**Mode:** Lightweight (Medium tier — Sections 2 and 4 full; 3 and 5 skipped per the tier rules)
**Input reviewed:** `.docs/specs/bin-teardown-run-a-project-supplied-teardown-hook-.md` (FR-1 … FR-12)
and `.docs/architecture/bin-teardown-run-a-project-supplied-teardown-hook-.md`. Stories and plan do
not exist yet — this review runs before `/stories`, per adr-2026-06-29-architecture-before-stories-convergent-kickback.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
| --- | --- |
| **Stack compatibility** | No new dependency. `execa` is already the process seam and already carries a `timeout` option in-repo (`mermaid-renderer.ts:406`). The coverage guard needs only `typescript`, already a direct dependency of `test/structural/test-execution-policy.test.ts`. |
| **Prerequisites** | None. `sanitizeNamespace`, `NAMESPACE_VAR`, `SETUP_SCRIPT`, and the output-tail helper all already exist in `worktree-prepare.ts`. The new config key follows two existing resolvers in `resolved-config.ts:470-540`. |
| **Integration surface** | Four production modules (`worktree-prepare`, `daemon-deps`, `daemon-park-cli`, `park-reconciliation`) plus `resolved-config`. Three of the four are single-line invitations; the substance is in one new function. Below the 3-boundary flag threshold in spirit — the boundaries are touched, not crossed, since nothing new flows between them. |
| **Data implications** | None. No schema, no migration, and deliberately **no persisted state**: the namespace is recomputed from the worktree path (`sanitizeNamespace(basename(worktreePath))`), which is what lets FR-3 hold for a worktree recreated from its branch. |
| **Performance risk** | One bounded child process per worktree removal, on paths that already spawn git. Worst case adds the configured bound (default 120 s) to a reap, only when a project script hangs. No loops, no queries, no unbounded work. |
| **Worktree isolation** | This feature *is* worktree-isolation machinery. It introduces no shared service, port, or database of its own; it hands the project the same per-worktree identity it already receives at setup, which is the established boundary pattern rather than a departure from it. |

**Feasibility verdict: clear.** No spike needed, no unknown technology, no external service.

## Alignment

**Convention over precedent.** Checked against `.docs/decisions/`, `.docs/architecture/`,
`CLAUDE.md`, and `.memory/decisions/bin-teardown-approach.md`.

- **`CLAUDE.md` design principle — deterministic where possible.** The design satisfies this in
  two distinct places, and both were load-bearing in the option selection. Containment is
  structural: because `git worktree remove` is reached on every branch of the runner's control
  flow, FR-6 and FR-7 hold by construction rather than by a caller remembering to `catch`.
  Coverage is machinery: FR-10's guard rejects an unclassified removal path at validation time,
  which is the principle's own prescribed remedy for a rule that would otherwise depend on
  authorial memory. A version of this feature without the guard was considered and rejected
  precisely on this clause.
- **Scope-check (`.agents/skills/scope-check/SKILL.md`).** Decision A returns **consumer-facing**:
  no self-host, sandbox, or `isSelfBuild()` gate is involved, and `bin/setup` plus
  `WORKTREE_NAMESPACE` are already documented consumer conventions in
  `docs/reference/environment.md`. Documentation therefore lands in `docs/`, not
  `docs/contributing/self-hosting`, and any behavioral rule belongs in `HARNESS.md` rather than
  `AGENT_INSTRUCTIONS.md`. Decision B is not reached (no new skill). Decision C returns
  **provider-agnostic**: the feature is a child process executed by the engine and names no
  Claude- or Codex-specific path, variable, or capability.
- **Pattern consistency.** The runner is a direct sibling of `runProjectSetup` and reuses its
  argument shape, environment construction, absent-script contract, and output-tail helper. The
  config key follows `auth_park_timeout_minutes` and `provider_preparation_timeout_minutes`. The
  structural guard follows `test-execution-policy.test.ts`, including its fail-closed treatment
  of argument forms it cannot statically resolve. **No new pattern is introduced**, which is why
  the ADRs record decisions rather than departures.
- **One deliberate divergence, called out.** `teardown_timeout_seconds` treats zero as invalid
  and falls back to the default, whereas the neighbouring `auth_park_timeout_minutes` treats zero
  as an opt-out signal. The divergence is intentional — an unbounded project script on the
  daemon's critical path is the exact hazard the bound exists to prevent — and is recorded in
  `adr-2026-08-07-project-teardown-hook-contract-and-containment` §Decision.2 with a requirement
  that the configuration reference state it explicitly. Flagged here because a reader who knows
  the sibling key will otherwise assume the familiar semantics.
- **State management.** The runner is stateless and its result type carries no error. There is no
  boolean-flag or implicit-state concern to raise: the only branch is present/absent script, and
  the only outcomes are success, non-zero, and timeout, each with a distinct log line.
- **Security boundaries.** The feature executes project-supplied code — but strictly the same
  code, from the same repository, with the same privileges and the same environment the harness
  already executes at setup. It introduces no new trust boundary, no new input parsing, and no
  new network or credential surface.
- **Diagram accuracy.** `.docs/architecture/bin-teardown-run-a-project-supplied-teardown-hook-.md`
  matches this review's conclusions, including the `keep === true` early-return placement and the
  distinction between the exempt-and-leaking path and the exempt-because-provisions-nothing paths.
  Both Mermaid blocks pass `conduct-ts render-diagrams --check`.

**One correction the review makes to the design as drawn.** The PRD's Open Question on the
reconciliation fallback is resolved *not* by invoking teardown in both branches but by invoking it
**once, before the removal attempt**, inside the existing `worktreeOnDisk` guard. That single
placement covers the `git worktree remove` branch and the `rm -rf` fallback together, runs while
the directory is intact, and avoids two divergent call sites in one function. Recorded in
`adr-2026-08-07-project-teardown-hook-contract-and-containment` §Decision.5.

## Wiring Surface

Design-time commitment for each new production surface. No `file:line` is cited — the code does
not exist yet. This is the precursor `/plan` derives its per-task `Wired-into:` contract from, and
it is independent of the §12 as-built reachability sweep that runs at SHIP against shipped code.

| New surface | Where it is called from in production |
| --- | --- |
| `runProjectTeardown(worktreePath, log, opts)` — new export from `src/conductor/src/engine/worktree-prepare.ts` | Three call sites: `daemon-deps.ts` `teardownWorktree`, **after** the `keep === true` early return (reached in production by the post-ship reap at `mergeable-sweep.ts`, its only `keep === false` caller); `daemon-park-cli.ts` `reclaim-worktree`, immediately before `removeWorktree`; and `park-reconciliation.ts`, immediately before the removal attempt inside the `worktreeOnDisk` guard. |
| `TEARDOWN_SCRIPT` constant (`bin/teardown`) — new export from the same module | Consumed by `runProjectTeardown` for path resolution, and by the structural guard for its routed-module assertion. Sibling of the existing exported `SETUP_SCRIPT`. |
| `teardown_timeout_seconds` — new top-level config key | Resolved in `src/conductor/src/engine/resolved-config.ts` alongside `auth_park_timeout_minutes` and `provider_preparation_timeout_minutes`; the resolved value is threaded to `runProjectTeardown` through the same options path `daemon-deps` already uses to pass `verbose` into `prepareWorktree`. |
| Teardown failure / timeout log lines (stable greppable prefix) | Emitted through the `log` sink each call site already holds — the daemon log for the reap and reconciliation paths, the CLI `out` sink for `reclaim-worktree`. No new channel. |
| Worktree-removal coverage guard — new suite in `src/conductor/test/structural/` | Executed by the existing structural test suite in the standard `vitest` run and in CI. Not production-reachable by design: it asserts the shape of production code at validation time. |

**Early overlap scan (advisory).** `conduct-ts overlap-scan` over the five candidate paths returns
a large set of historical and merged spec branches that touched `worktree-prepare.ts` — it is the
most-edited module in the engine. No unmerged branch was found holding a competing edit to the
setup/teardown seam, the three removal call sites, or `resolved-config.ts`'s timeout resolvers.
Advisory only; it does not condition the verdict.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| A failing teardown still leaks the resource — containment was chosen over blocking | Technical | Medium | Medium | Accepted by design and operator-confirmed. FR-8's stable log prefix plus the 50-line output tail make the leak diagnosable at the moment it occurs; the alternative (blocking) converts a leak into a stalled daemon. |
| Teardown runs against a worktree a human is about to resume, releasing a live build's resources | Data | Low | **High** | Structural: the invitation sits **after** `teardownWorktree`'s `keep === true` early return, so both retaining callers (`daemon-runner.ts:357`, `:504`) never reach it. Must be covered by an explicit negative test — see Conditions. |
| Default 120 s bound proves wrong for a real consumer's release step | Technical | Medium | Low | The key exists precisely for this. A too-short bound is visible as a timeout log entry naming the worktree, not a silent truncation. |
| Coverage guard produces false positives on unrelated refactors and gets suppressed | Knowledge | Low | Medium | AST-based rather than textual, so comments and log strings are invisible to it; the failure message must name the module, the two classification options, and the ADR. |
| `worktree-shared.removeWorktree` is later "helpfully" given a teardown call, silently pulling engineer authoring worktrees into scope | Technical | Low | Medium | The guard keys on the calling module, not the helper, and `worktree-shared.ts` is an explicit exempt entry whose reason states that classification belongs to its callers. |
| The `autoresolve` leak is forgotten because this spec shipped and looked complete | Knowledge | Medium | Medium | Recorded as a reasoned exemption-registry entry whose text distinguishes it from the provisions-nothing exemptions, called out in the PRD's Scope/Out, and filed as separate work. |

No risk carries an unmitigated High impact.

## ADRs Created

Both are `Status: APPROVED` — no draft ADR blocks the land gate.

1. **`adr-2026-08-07-project-teardown-hook-contract-and-containment`** — settles four of the PRD's
   five Open Questions: the time bound (120 s default, `teardown_timeout_seconds` override, no
   opt-out), the runner's placement (co-located with `runProjectSetup`), the reconciliation
   fallback (one invitation before the removal attempt, covering both branches), and durable
   surfacing (log only, with the reasoning that the natural home for a durable record is the
   worktree being deleted). Also fixes the invitation points, including the `keep === true`
   ordering constraint.
2. **`adr-2026-08-07-worktree-removal-coverage-guard`** — settles the fifth: an AST structural
   guard keyed on the **calling module** rather than the shared helper, with a four-entry
   exemption registry. The keying is load-bearing: `worktree-shared.removeWorktree` is shared
   between an in-scope caller and an operator-excluded one, which rules out the otherwise obvious
   one-line design.

**ADR trigger categories touched:** Cross-Cutting Concerns (error handling and resilience
patterns; observability) and Infrastructure (worktree isolation boundary changes). Both are
documented rather than skipped, per the lightweight-mode rule that the threshold is the decision
category, not the feature size.

## Conditions

Proceed to `/stories`. These are tracked in the plan and checked by the evaluator at code review;
unmet at `/finish` they are blocking.

1. **A negative test proves teardown does not run when `keep === true`.** This is the highest-impact
   risk in the register — releasing the resources of a build a human is about to resume — and it is
   an ordering property inside one function, invisible to any test that only asserts teardown runs
   on the reap path.
2. **A test proves removal still happens on every failure branch** — non-zero exit, timeout, and
   spawn error — and that the enclosing operation's outcome (reap, reclaim, reconciliation) is
   unchanged. FR-6 and FR-7 are the feature's safety claim; asserting only the success path would
   leave it unproven.
3. **A test proves the absent-script path emits no log output at all.** FR-4 promises non-adopting
   projects a byte-identical log, which is stricter than the setup side's behavior of logging one
   line — an easy detail to lose by copying `runProjectSetup` verbatim.
4. **The exemption registry ships with all four entries and non-empty reasons**, with
   `autoresolve.ts`'s reason distinguishing it as a known, deferred leak rather than a
   provisions-nothing case (FR-11).
5. **Same-PR documentation**, per `CLAUDE.md`: `docs/reference/environment.md` (the hook and its
   environment), `docs/reference/configuration.md` (the new key, **including** the deliberate
   zero-value divergence from `auth_park_timeout_minutes`), `docs/guides/running-the-daemon.md`,
   `docs/runbooks/worktree-and-evidence-recovery.md`, and `docs/contributing/testing.md` (how to
   classify a new removal path).
6. **`test/test_harness_integrity.sh` passes** before commit, per this repository's validation rule.

## Blocking Issues

None.
