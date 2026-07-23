**Status:** Accepted

# Stories: Canonical tracker-client seam with per-backend transport contract (#846)

Technical track — no PRD. Requirements (TR-N) derive from
`adr-2026-07-22-canonical-tracker-client-seam` (APPROVED) and the three conditions in
`architecture-review-2026-07-22-canonical-tracker-client-seam.md`. Source:
jstoup111/ai-conductor#846 (Refs #774).

---

## Story: Canonical tracker-client module with a single guarded production factory

**Requirement:** TR-1

As a harness developer, I want one canonical module exporting the `TrackerClient`
interface, the `GhRunner` type, and the only production `gh` factory, so that every
issue-side tracker operation flows through a single, uniformly guarded seam.

### Acceptance Criteria

#### Happy Path
- Given `engine/tracker-client.ts` exists, when a caller imports `TrackerClient`,
  `GhRunner`, `makeProductionGh`, and `createGithubTrackerClient`, then all four are
  exported from that module and typecheck against the canonical shapes
  (`GhRunner = (args: string[], opts: { cwd: string }) => Promise<{ stdout: string }>`).
- Given a `GitHubTrackerClient` constructed with an injected fake runner, when any
  interface method is called, then the fake runner receives the expected `gh` argv and
  no real process is spawned.

#### Negative Paths
- Given `AI_CONDUCTOR_NO_REAL_EXEC=1` (as set by `test/setup.ts`), when any code path
  obtains a runner from `makeProductionGh()` and invokes it, then it throws via
  `assertRealExecAllowed` BEFORE spawning a process — including paths reached from the
  engineer CLI and halt-issues CLI composition roots (the two current bypass holes).
- Given the underlying `gh` process exits non-zero, when a `TrackerClient` method runs,
  then the method rejects with an error carrying the failing argv and stderr content —
  it does not resolve with empty/partial data.

### Done When
- [ ] `src/conductor/src/engine/tracker-client.ts` exports `TrackerClient`, `GhRunner`,
      `makeProductionGh`, `createGithubTrackerClient`.
- [ ] A unit test proves `makeProductionGh()` throws under `AI_CONDUCTOR_NO_REAL_EXEC`
      with no child process spawned.
- [ ] `rg "makeProductionGh" src/conductor/src --type ts -l` returns ONLY
      `tracker-client.ts` as a definition site (other hits are imports/re-exports).

---

## Story: GitHub client implements the issue-side operation set with faithful argv mapping

**Requirement:** TR-2

As a harness developer, I want `createGithubTrackerClient` to cover the verified union
of issue-side operations, so that migrated call sites keep byte-identical `gh` behavior.

### Acceptance Criteria

#### Happy Path
- Given a client with a fake runner, when each operation is invoked — get issue labels,
  add label, read `blocked_by` dependencies, comment on issue, create issue, view issue
  (state/body), close issue, viewer identity, and list issues (the assignee-scoped
  list/search query `poll()` depends on — also required by #849's Jira polling) — then
  the runner receives the same `gh` argv the pre-migration call site produced (label reads via
  `gh api repos/«owner»/«repo»/issues/«n»`, deps via
  `.../issues/«n»/dependencies/blocked_by`, identity via `gh api user --jq .login`, …).
- Given an operation that targets another repo (e.g. filing to `--repo owner/repo`),
  when invoked with a repo argument, then the argv carries the same repo targeting the
  pre-migration site used (flag or `GH_REPO`-equivalent), verified against the old argv.

#### Negative Paths
- Given `gh` returns stdout that is not valid JSON for a JSON-parsing operation, when
  the operation runs, then it rejects with a parse error naming the operation — it does
  not return `undefined` or silently coerce.
- Given a label/comment operation against an issue that does not exist (gh exits
  non-zero with a 404 body), when invoked, then the rejection preserves the 404 evidence
  so callers that treat not-found as advisory (e.g. label strip in `forget`) can keep
  their existing best-effort behavior.

### Done When
- [ ] Every operation has a unit test asserting exact argv against a fake runner.
- [ ] Argv parity with pre-migration call sites is asserted for: label read
      (backlog-priority), blocked_by read (blocker-resolver), comment + label add +
      assignee-scoped issue list (github-issues adapter, incl. `poll()`), issue create
      (file-issue), issue view (wiring-probe), identity (owner-gate),
      close/edit/comment (halt-issues).
- [ ] JSON-parse failure and non-zero-exit tests exist per parsing operation.

---

## Story: Issue-side call sites migrate onto the seam; duplicate runner declarations deleted

**Requirement:** TR-3

As a harness developer, I want all issue-side modules to depend on the canonical seam,
so that no independently re-declared runner shape survives and a Jira client (#849) has
exactly one integration point.

### Acceptance Criteria

#### Happy Path
- Given the migration is complete, when the issue-side modules run their existing test
  suites (`github-issues`, `file-issue`, `backlog-priority`, `blocker-resolver`,
  `issue-dep-migration`, `owner-gate/identity`, `wiring-probe`), then all pass with
  fakes injected through the canonical types (per-module local runner types removed).
- Given the engineer CLI claim path runs end-to-end in tests, when priority bands and
  blocker verdicts are resolved, then the label reader and blocker resolver consume the
  injected `TrackerClient`/canonical runner and produce the same claim outcomes as
  before migration.

#### Negative Paths
- Given the repo after migration, when scanning for stray declarations, then
  `rg "=> Promise<\{ stdout" src/conductor/src --type ts` (and equivalent for
  `ExecRunner|BlockerRunner|FileIssueGhRunner|GhAbstraction` type declarations) finds
  no gh-runner-shaped TYPE DECLARATION outside `tracker-client.ts` — imports and
  re-exports are the only permitted references. (PR-side `CommandRunner` in
  `handoff.ts` is exempt: PR-side, out of scope.)
- Given a module that genuinely needs raw exec (no semantic client method), when it is
  migrated, then it imports the canonical `GhRunner` type rather than re-declaring it —
  verified by the same scan.
- Given shipped callers of today's no-`cwd` runner shapes (`overlap-scan.ts`
  constructing `createBlockerResolver`, `wiring-probe.ts`), when their runner types
  widen to the canonical `(args, { cwd })` signature, then the construction sites are
  updated mechanically to supply `cwd` and their existing behavioral contracts
  (closed-blocker filtering, probe verdicts) are proven unchanged by their existing tests.
- Given `github-issues.ts` `report()` and `poll()`, when migrated, then `report()`'s
  advisory-catch semantics and caller-supplied-cwd selection (engineer-handoff-writeback
  story) are preserved, `poll()`'s enqueue behavior stays byte-equivalent to main
  (intake-only-enforcement pins), and `dependency-claim.ts` is not touched at all.

### Done When
- [ ] The grep gate above is encoded as a checked-in test (not a manual step) and passes.
- [ ] All listed modules' unit tests pass with the canonical injection.
- [ ] `engineer-cli.ts` and `daemon-cli.ts` composition roots construct the client/runner
      from `tracker-client.ts` (their local `makeProductionGh` copies deleted).

---

## Story: halt-issues folds `GhAbstraction` into `TrackerClient` with behavior parity

**Requirement:** TR-4

As a harness developer, I want halt-issues' object-shaped `GhAbstraction` replaced by
the canonical `TrackerClient`, so the engine has one issue-ops interface, without
changing halt-sweep/closer behavior.

### Acceptance Criteria

#### Happy Path
- Given the halt-issues sweep and closer suites, when run against a fake
  `TrackerClient`, then existing behaviors (read issue body/labels/state, upsert body,
  upsert comment, close) pass unchanged — including the halt-monitor story's pinned
  call-count invariants: a steady-state sweep makes ZERO tracker calls, and a
  transitioning entry stays within its exact pre-migration per-operation call bound
  (at most one state read + comment upsert + close + conditional label read); the
  interface fold-in introduces no additional round-trip.
- Given the production halt-issues CLI, when it constructs its client, then it uses the
  canonical factory (guarded) and preserves repo targeting equivalent to the previous
  `GH_REPO` env injection.

#### Negative Paths
- Given a `gh` failure during a sweep step (previous code used `reject: false`
  semantics), when an operation fails, then the sweep continues/degrades exactly as the
  pre-migration behavior did (failure tolerated where it was tolerated, surfaced where
  it was surfaced) — asserted by tests that inject failures per operation.
- Given `AI_CONDUCTOR_NO_REAL_EXEC=1`, when the halt-issues CLI wiring is exercised in
  tests, then no real `gh` can be spawned (the old unguarded `makeProductionGh` at
  `halt-issues-cli.ts:103` is gone).

### Done When
- [ ] `GhAbstraction` type no longer exists; sweep/closer depend on `TrackerClient`.
- [ ] Failure-tolerance parity tests pass (per-operation injected failures).
- [ ] halt-issues CLI construction goes through the guarded canonical factory.

---

## Story: PR-side paths untouched and `pr-labels.ts` diff stays minimal

**Requirement:** TR-5 (review Condition 1)

As a maintainer with 142 unmerged branches touching `pr-labels.ts`, I want the seam to
leave PR-side machinery and `pr-labels.ts` structurally intact, so sibling branches
rebase cleanly and #774's code-stays-on-GitHub boundary holds.

### Acceptance Criteria

#### Happy Path
- Given the feature diff, when inspecting PR-side modules (`engineer/issue-ref.ts`,
  `engineer/intake/delivery-guard.ts`, `engineer/handoff.ts`), then their `gh pr`
  invocation code is byte-unchanged (type-import-only changes permitted).
- Given `pr-labels.ts`, when the feature lands, then its existing exports
  (`GhRunner`, `makeProductionGh`, `makeProductionGit`, `assertRealExecAllowed`, label
  helpers) still resolve for existing importers — via re-export from or import into the
  canonical module — and all current `pr-labels` tests pass unmodified.

#### Negative Paths
- Given the feature diff, when measuring `git diff main -- src/conductor/src/engine/pr-labels.ts`,
  then the change is limited to the guard/factory/type canonicalization hookup (no
  function bodies of PR machinery edited); a diff touching PR-flow functions fails review.
- Given a sibling branch that imports `GhRunner` from `pr-labels.ts`, when rebased onto
  this feature, then the import still typechecks (no removed/renamed export without a
  re-export shim).

### Done When
- [ ] PR-side `gh pr` call sites byte-unchanged (verified in diff review).
- [ ] `pr-labels.ts` keeps (or re-exports) every current public export; its test file
      passes without edits.
- [ ] Feature diff for `pr-labels.ts` ≤ the canonicalization hookup (reviewed against
      Condition 1).

---

## Story: Tracker config contract documented, reserved, and provably unread

**Requirement:** TR-6 (review Condition 3)

As the author of #845/#849, I want the per-project `tracker` config contract written
down and reserved — but not consumed — so I can build backend selection and Jira
transports against a stable shape without this feature front-running them.

### Acceptance Criteria

#### Happy Path
- Given `docs/configuration.md` and `src/conductor/README.md`, when reading the config
  reference, then the `tracker` key contract is documented:
  `tracker: { backend: github|jira, transport?: api|mcp, credentials?: <reference> }`,
  marked **reserved — not yet read by the engine; consumed by backend selection (#845),
  Jira transports (#849)**, with `github` documented as the zero-config default.
- Given `CHANGELOG.md`, when the PR lands, then an `[Unreleased]` entry records the
  seam + the reserved contract.

#### Negative Paths
- Given the engine source, when scanning for consumption, then no non-test code reads a
  `tracker` key from `HarnessConfig`/registry (`rg "\btracker\b" src/conductor/src`
  hits only types/docs/comments if anything) — the contract is documentation-level.
- Given `src/conductor/package.json`, when the feature lands, then no
  `@modelcontextprotocol` (or other MCP/Jira SDK) dependency was added.
- Given a project with NO `tracker` key configured, when any engine path runs, then
  behavior is byte-identical to pre-feature (GitHub via `gh` CLI, existing auth) — no
  new required config, no warning noise.

### Done When
- [ ] `docs/configuration.md` + `src/conductor/README.md` carry the reserved contract.
- [ ] `CHANGELOG.md` `[Unreleased]` entry present.
- [ ] Grep evidence: no engine consumption of `tracker` config; no new dependency in
      `package.json`.
