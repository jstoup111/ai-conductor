# ADR: Canonical tracker-client seam with per-backend transport contract

**Date:** 2026-07-22
**Status:** APPROVED
**Deciders:** James (operator) + engineer DECIDE (architecture-review)
**Feature:** canonical-tracker-client-seam-with-per-backend-tra (jstoup111/ai-conductor#846, Refs #774)

## Context

Every issue-side tracker operation in the engine shells out to the `gh` CLI through a
function-typed runner that is independently re-declared across the engine with three
shapes (verified, agent audit 2026-07-22):

- Canonical shape `(args: string[], opts: { cwd: string }) => Promise<{ stdout: string }>`:
  `engineer/loop.ts:69` (reference), `pr-labels.ts:26`, `engineer/issue-ref.ts:17`,
  `engineer/intake/github-issues.ts:24`, `owner-gate/identity.ts:23`,
  `engineer/intake/delivery-guard.ts:16`, `engineer/issue-dep-migration.ts:204`,
  `engineer/intake/file-issue.ts:18` (`FileIssueGhRunner`), `backlog-priority.ts:7`
  (`ExecRunner`).
- Narrower no-opts shape: `blocker-resolver.ts:23` (`BlockerRunner`), `wiring-probe.ts:503`.
- Object-shaped issue-ops interface: `GhAbstraction` (`halt-issues/sweep.ts:30`,
  `halt-issues/closer.ts:19`) with named methods (`getIssueLabels`, `closeIssue`, …).

`makeProductionGh()` exists three times (`pr-labels.ts:61`, `engineer-cli.ts:513`,
`halt-issues-cli.ts:103`) and only the `pr-labels.ts` copy honors the
`AI_CONDUCTOR_NO_REAL_EXEC` kill-switch (`assertRealExecAllowed`, `pr-labels.ts:41-58`)
— the other two can shell out during tests (verified).

The Jira epic (#774, closed umbrella) requires a single seam where a Jira backend can be
introduced. Sibling tickets: #845 (per-project backend selection + composition root),
#847 (canonical source-ref parsing), #849 (JiraAdapter), #851/#852/#853 (reads, close,
writebacks through the seam). Operator-confirmed scope for THIS feature: **seam +
contract only** — no Jira transport implementation, no composition-root selection.

Constraint carried from #774: PR-side `gh` usage is out of scope — code hosting stays on
GitHub. Verified PR-side call sites that must NOT migrate: `engineer/issue-ref.ts`
(`gh pr`), `engineer/intake/delivery-guard.ts` (`gh pr`), `engineer/handoff.ts`
(`gh pr create`), and `pr-labels.ts` PR machinery (labels on PRs ride the issues REST
path but are PR operations).

## Options Considered

### Option A (chosen): One object-shaped `TrackerClient` interface over one canonical runner
A single `TrackerClient` interface with named issue-side operations — the verified union
of what call sites do today: get/add issue labels, read dependency links (`blocked_by`),
comment, create issue, view issue (state/body), close issue, viewer identity. Implemented
by `GitHubTrackerClient` wrapping the one canonical `GhRunner` type and the one
kill-switch-guarded `makeProductionGh()`. All issue-side call sites take an injected
`TrackerClient` (existing DI convention: optional param / deps-object with production
fallback). `halt-issues`' `GhAbstraction` folds in — it is already this shape.
- **Pros:** one obvious seam for #849–#853 to target; matches the engine's existing
  runner-injection convention and ADR-009's ports discipline; closes the kill-switch
  bypass holes by construction; one fake serves all tests.
- **Cons:** wider interface than any single caller needs (fakes carry unused methods);
  a big-bang migration of ~10 call sites in one feature.

### Option B: Narrow capability ports per call site (grown from ADR-009)
One small interface per capability (`IssueLabelReader`, `BlockerReader`, …) with
per-backend adapter sets.
- **Pros:** minimal fakes; interface-segregation purity.
- **Cons:** ~8 interfaces whose shapes are near-identical (verified); every downstream
  ticket must learn the map; transport + auth config still needs one shared home.

### Option C: Type + factory dedup only
Export one canonical `GhRunner` + one guarded `makeProductionGh`; no semantic interface.
- **Pros:** tiny.
- **Cons:** no seam a Jira implementation can target — fails #846's core outcome; #849
  would redo the work.

## Decision

**Option A.** Concretely:

1. **New module `engine/tracker-client.ts`** exporting:
   - `TrackerClient` — the object-shaped interface of issue-side operations (union
     above; grown additively by later tickets, e.g. #853's transition mapping).
   - The canonical `GhRunner` type (single declaration; all re-declarations deleted).
   - `makeProductionGh()` — the ONLY production gh factory, calling
     `assertRealExecAllowed` so `AI_CONDUCTOR_NO_REAL_EXEC` is honored uniformly.
   - `createGithubTrackerClient(runner, opts)` — the GitHub implementation over the
     `gh` CLI, constructed unconditionally today (GitHub needs zero new config).
2. **Migrate issue-side call sites** to inject `TrackerClient` (or, where a module
   genuinely only needs raw exec, the canonical runner type): `github-issues.ts`,
   `file-issue.ts`, `backlog-priority.ts`, `blocker-resolver.ts`,
   `issue-dep-migration.ts`, `owner-gate/identity.ts`, `wiring-probe.ts`,
   `halt-issues/*` (replacing `GhAbstraction`). PR-side call sites are untouched.
3. **Transport + auth config CONTRACT (documentation-level, consumed by #845):** a
   per-project `tracker` config key shaped as
   `tracker: { backend: github|jira, transport?: api|mcp, credentials?: <reference> }`,
   mirroring the `memory_provider` selection pattern
   (adr-2026-06-29-per-project-memory-provider-selection, `types/config.ts:361+`).
   This feature documents the contract and reserves the key; it does NOT read it —
   selection is #845's composition root, Jira transports are #849. `transport`/
   `credentials` are meaningful only for `backend: jira`; `github` keeps the `gh` CLI
   and its existing auth.

Because the GitHub client is constructed unconditionally and needs no config, **#846
has no build dependency on #845** — the contract is one-directional (#845 must host the
key shape defined here).

## Consequences

### Positive
- #849 (JiraAdapter), #851, #852, #853 all target one verified seam; #845's selector
  has a client factory to select.
- Kill-switch coverage becomes uniform — the `engineer-cli.ts` / `halt-issues-cli.ts`
  bypass holes close (test runs can no longer mutate live GitHub through those paths).
- ~12 duplicate type declarations and 2 duplicate factories deleted; one fake
  `TrackerClient` replaces per-module fake runners in tests over time.

### Negative
- Wide interface: fakes implement methods some tests never use (mitigated by a shared
  test fake with per-method defaults).
- A ~10-call-site migration in one feature is a broad (if mechanical) diff, with
  transient churn risk against unmerged sibling branches (overlap-scan advisory run at
  review time).
- The config contract is speculative until #845/#849 consume it; if Jira's real needs
  diverge (e.g. per-site URL), the contract may need a superseding ADR.

### Follow-up Actions
- [ ] #845 hosts the `tracker` config key exactly as contracted here (composition-root selection).
- [ ] #849 implements `JiraTrackerClient` over REST and/or MCP against this interface.
- [ ] #847's canonical ref parse/format becomes the `sourceRef` currency of `TrackerClient` methods.
