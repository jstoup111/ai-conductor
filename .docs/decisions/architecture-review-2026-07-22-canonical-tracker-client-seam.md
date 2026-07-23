# Architecture Review: Canonical tracker-client seam (#846)
**Date:** 2026-07-22
**Stories reviewed:** none yet (pre-stories DECIDE pass; input = issue #846 desired outcomes + operator-confirmed scope + approved diagrams)
**Verdict:** APPROVED WITH CONDITIONS
**Mode:** lightweight (Medium tier — feasibility + alignment)

## Feasibility

- **Stack compatibility:** VERIFIED clean. Pure TypeScript refactor + one new module;
  no new dependency (`@modelcontextprotocol` explicitly NOT added — MCP transport is
  contract-only, deferred to #849; package.json audit 2026-07-22).
- **Prerequisites:** none. GitHub path needs zero new config (`gh` CLI + existing
  auth); no migration, no external account. #845/#847 are contract-coupled, not
  build-order prerequisites (see ADR).
- **Integration surface:** wide but mechanical — ~10 issue-side call sites across
  intake, owner-gate, backlog-priority, blocker-resolver, issue-dep-migration,
  wiring-probe, halt-issues. All shapes verified near-identical
  (`(args, {cwd}) => Promise<{stdout}>` ± opts), so migration is signature-preserving.
  PR-side call sites (`issue-ref.ts`, `delivery-guard.ts`, `handoff.ts`, `pr-labels.ts`
  PR machinery) verified out of scope.
- **Data implications:** none (no schema, no persisted state).
- **Performance risk:** none — same `gh` invocations, one indirection layer.
- **Worktree isolation:** no new services/ports/state; safe in parallel worktrees.

## Alignment

- **Domain boundaries:** strengthens the ADR-009 hexagonal discipline — core code
  depends on the `TrackerClient` port; only composition roots construct the concrete
  client (mirrors `buildIntake`'s documented FR-13 rule: "the CLI is the only place
  that may" import concrete adapters).
- **Pattern consistency:** follows the engine's established runner-injection
  convention (optional-param default / deps-object with `?? makeProductionX()`
  fallback) and the provider-selection precedent
  (adr-2026-06-29-per-project-memory-provider-selection) for the config contract.
  The new pattern (object-shaped client) already exists in the codebase as
  halt-issues' `GhAbstraction` — this canonicalizes it; ADR drafted (below).
- **State management:** n/a (stateless client).
- **Diagram accuracy:** feature diagrams authored + render-checked this session
  (`.docs/architecture/canonical-tracker-client-seam-with-per-backend-tra.md`,
  `sequences/canonical-tracker-client-seam-issue-op.md`); operator-approved.
- **Security boundaries:** improves them — the `AI_CONDUCTOR_NO_REAL_EXEC` kill-switch
  becomes uniform (today `engineer-cli.ts:513` and `halt-issues-cli.ts:103` factories
  bypass `assertRealExecAllowed`; verified). Credentials for Jira are a config
  *reference* in the contract — no secret value lands in the registry or repo.
- **Production DI defaults:** production default is the real `gh`-CLI-backed client;
  no in-memory/fake registered as production default.

## Wiring Surface (design-time)

| New surface | Will be called from (production) |
|---|---|
| `engine/tracker-client.ts` → `TrackerClient` interface | Injected into every migrated issue-side module; constructed at existing composition roots: `engineer-cli.ts` (`buildIntake`, claim/poll/forget/resolve paths), `daemon-cli.ts` (backlog-priority / blocker-resolver wiring), `halt-issues/halt-issues-cli.ts` (sweep/closer) |
| `createGithubTrackerClient(runner)` | Same composition roots, as the unconditional default backend |
| Canonical `GhRunner` + single `makeProductionGh()` | Sole production fallback wherever a raw runner is still injected; all duplicate factories/type declarations deleted or re-exported from the canonical module |
| `tracker` config key contract (`backend`/`transport`/`credentials`) | NOT read by this feature — documented contract reserved for #845's composition-root selection; docs/configuration.md carries the schema |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| `pr-labels.ts` is overlapped by 142 unmerged spec branches; restructuring it invites mass rebase conflicts | Integration | High | Medium | Condition 1: minimal-diff strategy — new module imports `assertRealExecAllowed` from `pr-labels.ts` (or re-exports); do NOT move/rewrite pr-labels internals |
| Wide interface forces fakes to carry unused methods | Technical | Medium | Low | One shared test fake with per-method defaults; interface grows additively |
| Config contract diverges from Jira's real needs (#849) | Integration | Medium | Low | Contract is documentation-level; superseding ADR if #849 finds gaps |
| Big-bang migration misses a call site (a stray duplicate runner survives) | Technical | Medium | Medium | Story-level acceptance: grep gate — no `GhRunner`-shaped re-declarations outside the canonical module; kill-switch uniformity test |

## ADRs Created

- `adr-2026-07-22-canonical-tracker-client-seam` — **APPROVED** (operator, 2026-07-22)
  (interface + single guarded factory + config contract + no-build-dependency-on-#845).

## Conditions

1. **pr-labels.ts minimal diff:** the seam must not restructure `pr-labels.ts`. The
   canonical module imports (or re-exports) `assertRealExecAllowed`; existing exports
   from `pr-labels.ts` keep working (deprecation re-export if the canonical home moves)
   so the 142 overlapping branches rebase cleanly.
2. **Grep-verifiable completeness:** stories must include the negative acceptance
   signal "no independently re-declared gh-runner type outside `tracker-client.ts`"
   and "every production gh exec on the issue side passes `assertRealExecAllowed`".
3. **Contract, not code, for Jira:** no `jira`/MCP code paths, no new dependency; the
   `tracker` key is documented but unread (consumed by #845).
