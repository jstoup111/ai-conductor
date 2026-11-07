# Implementation Plan: Repo-wide diagnostic for plans whose Stories reference cannot resolve

**Date:** 2026-10-28
**Design:** technical track, no PRD; Tier S (no architecture review or ADR)
**Stories:** .docs/stories/no-repo-wide-diagnostic-for-plans-whose-stories-re.md
**Conflict check:** Skipped (Tier S)

## Summary

Adds `ai-conductor daemon stories-refs [--repo <path>]`, a read-only, network-free report of every
committed default-branch spec whose Stories reference does not resolve. Each finding names the plan,
the raw reference, the attempted path, the resolution kind, and the spec's lifecycle state. The
report is computed by the same candidate listing and Stories resolution daemon discovery uses,
extracted from `discoverBacklog` into shared functions so discovery and the diagnostic run one
implementation. Eight tasks.

## Technical Approach

- **One resolution, shared with discovery.** Since the per-feature manifest change
  (`adr-2026-10-24-per-feature-artifact-manifest` decisions 5 and 8), discovery has two candidate
  sources (committed `.docs/plans/*.md` stems and committed `.docs/<slug>/manifest.json` slugs) and
  two Stories paths: a legacy spec resolves through `resolveStoriesRef` (which wraps
  `resolvePlanStoriesPath`, the resolver land also uses), and a manifest-backed spec resolves its
  plan and stories through the manifest, failing closed on a malformed manifest. Land now writes a
  manifest for every composer spec, so a diagnostic that read only the plan's Stories line would
  disagree with discovery for every newly landed spec. Task 2 therefore extracts discovery's
  candidate listing (`listBacklogCandidates`) and its per-candidate plan-and-stories resolution
  (`resolveCandidateStories`) out of `discoverBacklog` into exported functions in
  `daemon-backlog.ts`, and `discoverBacklog` calls them. The extraction is behavior-preserving: the
  existing discovery test files are the guard and pass unchanged. The diagnostic classifies every
  candidate only through those two functions. This is the reader routing decision 5 requires of a
  stories reader, and it lets the manifest layout change planned as that ADR's spec 3 reach the
  diagnostic through the same functions.
- **Raw reference text.** `plan-stories-reference.ts` gains `readPlanStoriesReferenceText`, which
  returns the text after `**Stories:**` through the existing `STORIES_LINE` regex, so the report can
  quote a legacy reference without a second regex. A manifest-backed finding quotes
  `manifest <manifest path>` instead, because the plan's line is not the reference discovery used.
- **Same commit as discovery.** The default branch is `originDefaultBranch(makeGitRunner(root)) ??
  'main'`, the expression `src/conductor/src/daemon-cli.ts` uses. Task 5 extracts
  `resolveDaemonBase(projectRoot, baseBranch)` in `daemon-deps.ts`, returning `{ ref, sha }` from the
  same `origin/<default>`-then-`<default>` order `resolveWorktreeBase` applies, and
  `resolveDaemonBaseSha` delegates to it. The scan reads `gitTreeSource(root, sha)`, the tree discovery
  reads after daemon-cli pins `baseBranch: baseSha`. Only local refs are read; the verb never fetches.
- **Lifecycle states reuse production predicates, first match wins**, in discovery's own dedup order
  (processed, shipped, parked are checked before any content classification) followed by the
  dashboard's halt rule: `processed` (`isProcessed` in `daemon-deps.ts`, the predicate discovery is
  wired with), `shipped` (stem match against `listShippedRecords`, as discovery's shipped-by-stem
  dedup does), `parked` (`isOperatorParked` in `park-marker.ts`), `halted` (feature worktree has
  `HALT_MARKER` and no `DONE_MARKER`, the rule `scanInheritedState` in `daemon-dashboard.ts`
  applies), else `actionable`. All marker reads use the main repository root from
  `resolveMainRepoRootStrict`, so a run from a linked worktree reads the same `.daemon/`.
- **Read-only by construction.** The scan does not call `discoverBacklog`, so it never writes
  `.daemon/blocked.json`, `.daemon/warned/`, or `.daemon/processed/` repair markers, and never calls
  `fastForwardRoot`. The `BLOCKED` channel is untouched: `daemon status` keeps showing the
  actionable per-pass set, and this verb is the on-demand, repo-wide superset.
- **Clean versus failed.** A completed scan exits 0 whether or not it found broken references; it
  always prints the header (ref, commit, spec count) and either the findings plus a per-state summary
  or an explicit clean line. A scan that cannot run (path not in a Git repository, no resolvable base
  commit, or any thrown error) writes `stories-refs: scan failed — <reason>` to stderr, prints no clean
  line, and exits 1, following the `shipment-evidence audit` precedent in `shipment-evidence-cli.ts`.
- **CLI placement.** The verb sits beside `daemon status` and `daemon logs` in
  `daemon-observe-cli.ts`'s hand-rolled detect/dispatch, which `index.ts` checks before the daemon run
  command. It is added to `DAEMON_SUBVERBS`, excluded in `detectDaemonCommand`, and declared in
  `src/conductor/src/cli.ts` for help, so it can never launch a daemon run. Its `--repo <path>` option
  mirrors `daemon logs`. It is a separate verb, not a `daemon status` section, because `daemon status`
  sweeps every registered repo's live daemon state, while this report reads one repository's
  committed tree on demand and must report its own scan failure distinctly.
- **Release.** Additive CLI verb: the implementation PR carries `Release-Disposition: note`,
  `Release-Category: Added`. It touches no `bin/conduct`, `bin/install`, hook, skill, or settings path
  that `classifyBreakingSurfaces` flags, so it needs no migration block or release waiver. The CLI
  reference update is left to the pre-finish documentation gate.

## Prerequisites

- None.

## Tasks

### Task 1: Expose the raw Stories reference text through the shared resolver module
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-stories-reference.test.ts` for every Done-when check below. The new export is `readPlanStoriesReferenceText(planContent: string): string | null`.
2. Verify RED.
3. Implement in `src/conductor/src/engine/plan-stories-reference.ts`: `readPlanStoriesReferenceText` matches the existing module-level `STORIES_LINE` regex and returns capture group 1, or `null` on no match. Do not add a second regex and do not change `resolvePlanStoriesPath`.
4. Verify GREEN with `ai-conductor scoped-run` on the resolver test file, commit.

**Done when:**
- [test] `readPlanStoriesReferenceText` returns the text after `**Stories:**` exactly as written, trimmed of surrounding whitespace only, for a plain path, an inline-code path with a trailing `(Accepted)` annotation, and a Markdown link, as asserted in `plan-stories-reference.test.ts`
- [test] `readPlanStoriesReferenceText` returns `null` for plan content with no `**Stories:**` line
- `readPlanStoriesReferenceText` and `resolvePlanStoriesPath` both read the line through the single module-level `STORIES_LINE` regex, and the existing `resolvePlanStoriesPath` tests pass unchanged

**Files likely touched:**
- `src/conductor/src/engine/plan-stories-reference.ts` — new raw-text export
- `src/conductor/test/engine/plan-stories-reference.test.ts` — unit tests

**Dependencies:** none

### Task 2: Extract discovery's candidate listing and Stories resolution into shared functions
**Story:** Story 3
**Type:** refactor

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-backlog-candidates.test.ts` for every Done-when check below, using an in-memory `BacklogTreeSource` like the `tree()` helper in `src/conductor/test/engine/daemon-backlog-manifest.test.ts`.
2. Verify RED.
3. Implement in `src/conductor/src/engine/daemon-backlog.ts`:
   - `export interface BacklogCandidate { slug: string; planFile?: string; manifestBacked: boolean }` and `export async function listBacklogCandidates(tree: BacklogTreeSource): Promise<BacklogCandidate[]>`. Move the existing candidate build (the `.docs/plans` stems from `listPlanFiles()` filtered to `.md`, merged by slug with the `.docs/<slug>/manifest.json` slugs from `listFeatureManifests?.()`) and the existing sort comparator (`${slug}.md` ascending) into it unchanged.
   - Move the `manifestPathFor` closure body to a module-level `resolveBacklogManifestPath(manifestSource, slug, kind)`; the closure delegates to it so the complexity, track, coherence, applicability, and intake reads keep their behavior.
   - `export type CandidateStoriesResolution` with variants `{ kind: 'no-plan' }`, `{ kind: 'malformed-manifest'; manifestPath: string; message: string }`, `{ kind: 'resolved'; planRel: string; planContent: string; storiesPath: string }`, `{ kind: 'unresolvable'; planRel: string; planContent: string }`, `{ kind: 'missing'; planRel: string; planContent: string; source: 'plan-line'; path: string }`, and `{ kind: 'missing'; planRel: string; planContent: string; source: 'manifest'; manifestPath: string; listed: readonly string[] }`.
   - `export async function resolveCandidateStories(tree, candidate, legacyPlanContent?)`. For a legacy candidate it reads the plan at `.docs/plans/<planFile>` (or uses `legacyPlanContent` when given), returns `no-plan` when the plan is absent, and maps `resolveStoriesRef` to `resolved`, `unresolvable`, or `missing` with `source: 'plan-line'`. For a manifest-backed candidate it resolves the plan through `resolveBacklogManifestPath(backlogTreeManifestSource(tree), slug, 'plan')`, returning `no-plan` when no plan resolves or its content is absent, and `malformed-manifest` with `featureManifestPath(slug)` and the error message when `MalformedFeatureManifestError` is thrown; then it resolves stories through `resolveFeatureArtifact(..., 'stories', async () => [])`, returning `resolved` for the first listed path that exists, else `missing` with `source: 'manifest'` and every listed stories path.
   - In `discoverBacklog`, build candidates with `listBacklogCandidates`, derive the plan-file list used by `undatedPlanStemCounts` from the candidates' `planFile` values so `listPlanFiles` is still called once per pass, keep the legacy plan read before `isProcessed` and the processed, shipped, and parked checks in their current order, then replace the manifest plan block and the Stories block with one `resolveCandidateStories(tree, candidate, planContent)` call. Map `no-plan` to `continue`, `malformed-manifest` to the existing `malformed-manifest` block, `unresolvable` to the existing `unresolvable-stories-ref` block, `missing` from `plan-line` to the existing `stories-missing` block naming the path, and `missing` from `manifest` to the existing manifest `stories-missing` block, each with its current remedy and log text.
4. Verify GREEN, including `src/conductor/test/engine/daemon-backlog.test.ts`, `src/conductor/test/engine/daemon-backlog-manifest.test.ts`, and `src/conductor/test/engine/daemon-backlog-applicability.test.ts` unchanged, commit.

**Done when:**
- [test] `listBacklogCandidates` returns legacy plan stems and manifest slugs de-duplicated by slug, with `manifestBacked` true for a slug that has both, ordered by `<slug>.md` ascending, as asserted in `daemon-backlog-candidates.test.ts`
- [test] `resolveCandidateStories` returns `resolved`, `unresolvable`, and `missing` with `source: 'plan-line'` and the referenced path for legacy candidates whose Stories line resolves, is an absolute path, and names an absent file
- [test] For manifest-backed candidates, `resolveCandidateStories` returns `resolved` when the listed stories file exists even though the plan's Stories line is unresolvable, `missing` with `source: 'manifest'` and the listed path when it is absent, `missing` with an empty `listed` when the manifest has no stories entry, `malformed-manifest` with the manifest path for an unparseable manifest, and `no-plan` when the listed plan is absent
- `src/conductor/test/engine/daemon-backlog.test.ts`, `daemon-backlog-manifest.test.ts`, and `daemon-backlog-applicability.test.ts` pass with no edits, and `discoverBacklog` obtains its candidates only from `listBacklogCandidates` and its Stories outcome only from `resolveCandidateStories`

**Files likely touched:**
- `src/conductor/src/engine/daemon-backlog.ts` — extracted candidate listing and Stories resolution
- `src/conductor/test/engine/daemon-backlog-candidates.test.ts` — unit tests for the extracted functions

**Dependencies:** none

### Task 3: Scan every discovery candidate and report the ones whose Stories reference does not resolve
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stories-refs-diagnostic.test.ts` for every Done-when check below. Build fixture repositories with real `git init` in a `mkdtemp` directory under `os.tmpdir()`, following `src/conductor/test/engine/daemon-backlog.test.ts` (search `mkdtemp(join(tmpdir(), 'daemon-backlog-`). Commit plans, stories, and manifests on `main`; add no `origin` remote. Render manifests with `buildFeatureManifest` and `renderFeatureManifest` from `feature-manifest.ts`. Build every fixture path in the test, not in this plan.
2. Verify RED.
3. Implement `src/conductor/src/engine/stories-refs-diagnostic.ts`. Export `scanStoriesRefs(repoPath: string): Promise<StoriesRefsScan>` where `StoriesRefsScan` is `{ kind: 'ok'; baseRef: string; baseSha: string; specCount: number; broken: BrokenStoriesRef[] }` or `{ kind: 'failed'; reason: string }`, and `BrokenStoriesRef` is `{ slug: string; plan: string | null; reference: string | null; attempted: readonly string[]; kind: 'missing' | 'unresolvable' | 'malformed-manifest'; state: StoriesRefState }`. Resolve the main root with `resolveMainRepoRootStrict`, the default branch with `originDefaultBranch(makeGitRunner(root)) ?? 'main'`, and the commit with `resolveDaemonBaseSha(root, defaultBranch)`. Build `gitTreeSource(root, baseSha)`, list candidates with `listBacklogCandidates`, set `specCount` to their number, and classify each ONLY with `resolveCandidateStories(tree, candidate)`: skip `no-plan` and `resolved`; `unresolvable` yields `attempted: []` and `reference: readPlanStoriesReferenceText(planContent)`; `missing` from `plan-line` yields `attempted: [path]` and the same reference; `missing` from `manifest` yields `attempted: listed` and `reference: 'manifest <manifestPath>'`; `malformed-manifest` yields `plan` equal to `.docs/plans/<planFile>` when the candidate has one else `null`, `attempted: []`, and `reference: 'manifest <manifestPath>: <message>'`. Set `state` to `'actionable'` for now.
4. Export `renderStoriesRefsReport(scan)` returning stdout lines; per finding emit `  • <plan> — <state> — <kind> — reference: <reference> — attempted: <attempted joined by ", ">`, rendering a `null` plan as `(unresolved plan)`, a `null` reference as `(no Stories line; same-stem fallback)`, and an empty `attempted` as `none`.
5. Verify GREEN, commit.

**Done when:**
- [test] For a legacy fixture plan whose Stories line names an absent stories file, `scanStoriesRefs` returns one finding with the plan's repo-relative path, the raw reference from `readPlanStoriesReferenceText`, `attempted` equal to the referenced path, and kind `missing`, and `renderStoriesRefsReport` prints all four on that finding's line
- [test] For legacy fixture plans whose Stories value is an absolute path, a path escaping the repository, and a non-`.md` target, findings have kind `unresolvable` and the rendered lines show the plan path, the raw reference text, `attempted: none`, and `unresolvable`; a legacy plan with no Stories line and no same-stem stories file renders the reference `(no Stories line; same-stem fallback)`, its same-stem attempted path, and `missing`
- [test] A manifest-backed fixture whose listed stories path is absent renders the manifest's plan path, `reference: manifest` with the manifest path, that listed path as attempted, and `missing`; one with no stories entry renders `attempted: none` and `missing`; an unparseable manifest renders `reference: manifest` with the manifest path and parse failure, `attempted: none`, and `malformed-manifest`
- [test] `scanStoriesRefs` returns no finding for a legacy plan whose inline-code Stories path with `(Accepted)` exists, a legacy plan whose same-stem stories file exists, a manifest-backed spec whose listed stories exist beside an unresolvable plan Stories line, or a manifest whose listed plan is absent
- `stories-refs-diagnostic.ts` classifies candidates only through `listBacklogCandidates` and `resolveCandidateStories` over `gitTreeSource` pinned to the scanned commit, and contains no Stories-line regex, manifest parsing, or path-validation logic of its own

**Files likely touched:**
- `src/conductor/src/engine/stories-refs-diagnostic.ts` — new scan and render module
- `src/conductor/test/engine/stories-refs-diagnostic.test.ts` — fixture-repository tests

**Dependencies:** Task 1, Task 2

### Task 4: Label each broken spec with its lifecycle state and summarize the counts
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stories-refs-diagnostic.test.ts` for every Done-when check below. Use five broken-reference fixture plans (main-root processed marker, committed shipped record with the plan's stem, main-root parked marker, worktree HALT without DONE, none of these), a plan that is both processed and parked, a plan whose worktree `.pipeline/` holds both `HALT` and `DONE`, and a run whose `repoPath` is a linked worktree created with `git worktree add` under the fixture's `.worktrees/`.
2. Verify RED.
3. Implement `classifyStoriesRefState(root, slug, shippedStems)` in `src/conductor/src/engine/stories-refs-diagnostic.ts`: `'processed'` when `isProcessed(root, slug)` (daemon-deps.ts) is true, else `'shipped'` when `slug` is among the stems from one `listShippedRecords(tree)` call (shipped-record.ts), else `'parked'` when `isOperatorParked(root, slug)` (park-marker.ts) is true, else `'halted'` when `<root>/.worktrees/<slug>/` contains `HALT_MARKER` (halt-marker.ts) and not `DONE_MARKER`, else `'actionable'`. Change `DONE_MARKER` in `src/conductor/src/engine/daemon-dashboard.ts` from a private `const` to an exported `const` and import it. `root` is always the main root. Extend `renderStoriesRefsReport` with `stories-refs: <total> broken (actionable <a>, halted <h>, parked <p>, shipped <s>, processed <x>)` when there are findings.
4. Verify GREEN, commit.

**Done when:**
- [test] `scanStoriesRefs` labels five broken fixture plans `processed`, `shipped`, `parked`, `halted`, and `actionable` when they respectively have a `.daemon/processed/<stem>` marker, a committed shipped record with that stem, a `.daemon/parked/<stem>` marker, a `.worktrees/<stem>/.pipeline/HALT` marker without `.pipeline/DONE`, and none of these
- [test] `renderStoriesRefsReport` prints a summary line giving the total broken count and the count for each of the five states, asserted against the five-plan fixture
- [test] A broken plan that is both processed and parked is labelled `processed` only, and a broken plan whose worktree holds both `.pipeline/HALT` and `.pipeline/DONE` is labelled `actionable` rather than `halted`
- [test] `scanStoriesRefs` given a linked worktree path labels a plan with a main-root `.daemon/processed/<stem>` marker `processed` and a plan with a main-root `.daemon/parked/<stem>` marker `parked`, neither `actionable`

**Files likely touched:**
- `src/conductor/src/engine/stories-refs-diagnostic.ts` — lifecycle classification and summary
- `src/conductor/src/engine/daemon-dashboard.ts` — export `DONE_MARKER`
- `src/conductor/test/engine/stories-refs-diagnostic.test.ts` — lifecycle tests

**Dependencies:** Task 3

### Task 5: Prove the report agrees with discovery and scans the commit discovery pins
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stories-refs-diagnostic.test.ts` for every Done-when check below. Parity fixture: a legacy `unresolvable` plan, a legacy `missing` plan, a manifest-backed spec with an absent listed stories file, a malformed manifest, a resolving plan, and a processed broken plan; call `discoverBacklog(root, (slug) => isProcessed(root, slug), () => {}, { baseBranch: <sha from resolveDaemonBaseSha>, writeBlockedSnapshot: async () => {} })` and `scanStoriesRefs(root)`. Base fixture: a bare repository as `origin`, push and fetch `main`, add a commit through a second clone that fixes one broken plan, fetch again so `origin/main` is ahead of local `main`. Also commit a broken plan only on a `spec/<slug>` branch, leave one untracked, stage one without committing, and make an uncommitted edit that breaks a committed resolving plan.
2. Verify RED.
3. Implement in `src/conductor/src/engine/daemon-deps.ts`: export `resolveDaemonBase(projectRoot, baseBranch): Promise<{ ref: string; sha: string } | undefined>` that tries `origin/<baseBranch>` then `<baseBranch>` with `git rev-parse --verify --quiet`, returning the ref that resolved and its SHA, or `undefined`; make `resolveWorktreeBase` and `resolveDaemonBaseSha` delegate to it so the order has one implementation. In `stories-refs-diagnostic.ts`, take `baseRef` and `baseSha` from `resolveDaemonBase`, and print `stories-refs: scanned <specCount> specs at <baseRef> (<first 9 chars of baseSha>)` first in `renderStoriesRefsReport` for every `ok` scan.
4. Verify GREEN, commit.

**Done when:**
- [test] The parity test asserts the set of slugs labelled `actionable` or `halted` equals the slugs `discoverBacklog` blocked with `unresolvable-stories-ref`, `stories-missing`, or `malformed-manifest`, each kind matching its reason (`unresolvable`, `missing`, `malformed-manifest`)
- [test] With `origin/main` ahead of local `main`, `scanStoriesRefs` returns `baseSha` equal to `resolveDaemonBaseSha` and the header names `origin/main` and that commit's abbreviated id; without an `origin/main` ref the header names `main`
- [test] A plan broken at local `main` but fixed at the newer `origin/main` tip is absent from the findings
- [test] A broken plan that exists only untracked, only staged, or only on an unmerged `spec/<slug>` branch is absent from the findings, and an uncommitted edit breaking a committed plan's Stories line does not make that plan appear
- `resolveDaemonBaseSha` returns `(await resolveDaemonBase(projectRoot, baseBranch))?.sha` and its existing callers' tests pass unchanged

**Files likely touched:**
- `src/conductor/src/engine/daemon-deps.ts` — `resolveDaemonBase` extraction
- `src/conductor/src/engine/stories-refs-diagnostic.ts` — base ref and header
- `src/conductor/test/engine/stories-refs-diagnostic.test.ts` — parity and base-selection tests

**Dependencies:** Task 4

### Task 6: Wire the read-only `daemon stories-refs` verb with explicit clean and findings output
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-observe-cli.test.ts` for every Done-when check below, driving `dispatchDaemonObserve(detectDaemonObserveCommand(['node', 'cli', 'daemon', 'stories-refs', '--repo', fixtureRoot]))` with stdout and stderr captured, over a clean fixture, a fixture with a broken reference, and a fixture whose commit has no plans and no manifests. Add `daemon stories-refs` cases in `src/conductor/test/engine/daemon-supervisor-command.test.ts` beside its `daemon logs` and `detectUnknownDaemonSubcommand` cases.
2. Verify RED.
3. Implement: add `{ kind: 'stories-refs'; repo?: string }` to `DaemonDispatch` in `src/conductor/src/engine/daemon-observe-cli.ts`; detect `daemon stories-refs` with `--repo <path>` or `--repo=<path>` (default `process.cwd()`), following the `logs` branch's argv parsing; dispatch to a new `runDaemonStoriesRefs({ repo }, { out, err })` that calls `scanStoriesRefs` and prints `renderStoriesRefsReport` lines, printing `stories-refs: clean — no spec has an unresolvable Stories reference` after the header for an `ok` scan with zero findings, and returning 0 for every `ok` scan. Add `'stories-refs'` to `DAEMON_SUBVERBS` and return null for it in `detectDaemonCommand` in `src/conductor/src/engine/daemon-command.ts`. Declare `daemon.command('stories-refs')` with its `--repo <path>` option and a description in `src/conductor/src/cli.ts` beside `status` and `logs`.
4. Verify GREEN, including `src/conductor/test/daemon-help-verb-drift.test.ts`, commit.

**Done when:**
- [test] `dispatchDaemonObserve` for `daemon stories-refs --repo <clean fixture>` prints the header with the scanned ref, abbreviated commit, and spec count, then `stories-refs: clean — no spec has an unresolvable Stories reference`, and returns 0
- [test] `dispatchDaemonObserve` for `daemon stories-refs --repo <fixture with a broken reference>` prints the finding lines and the summary line, prints no clean line, and returns 0
- [test] `dispatchDaemonObserve` over a fixture whose scanned commit has no plans and no manifests prints a header stating 0 specs scanned at the ref and abbreviated commit and returns 0
- [test] `detectDaemonCommand` returns null for `daemon stories-refs`, `detectUnknownDaemonSubcommand` returns null for it, and `renderDaemonHelp()` lists `stories-refs` so the daemon help verb drift test passes

**Files likely touched:**
- `src/conductor/src/engine/daemon-observe-cli.ts` — detect, dispatch, and run the verb
- `src/conductor/src/engine/daemon-command.ts` — subverb registry and run-command yield
- `src/conductor/src/cli.ts` — help declaration
- `src/conductor/test/engine/daemon-observe-cli.test.ts` — entry-point tests
- `src/conductor/test/engine/daemon-supervisor-command.test.ts` — detection tests

**Dependencies:** Task 5

### Task 7: Report a failed scan on stderr with exit 1 and never print a clean line
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-observe-cli.test.ts` for every Done-when check below, through `dispatchDaemonObserve(detectDaemonObserveCommand([...]))`, for `--repo` pointing at a `mkdtemp` directory outside any Git repository and for a fixture created with `git init` and no commits.
2. Verify RED.
3. Implement: `scanStoriesRefs` in `src/conductor/src/engine/stories-refs-diagnostic.ts` returns `{ kind: 'failed', reason }` when `resolveMainRepoRootStrict` returns null (reason names the path as not inside a Git repository) or `resolveDaemonBase` returns undefined (reason names `origin/<default>` and `<default>` as unresolvable). `runDaemonStoriesRefs` writes `stories-refs: scan failed — <reason>` to stderr and returns 1 for a `failed` result and for any thrown error, printing nothing else.
4. Verify GREEN, commit.

**Done when:**
- [test] `dispatchDaemonObserve` for `daemon stories-refs --repo <directory outside any Git repository>` writes one stderr line starting `stories-refs: scan failed` with the reason, writes no clean line and no summary line to stdout, and returns 1
- [test] For a fixture repository with no commits, it writes a `stories-refs: scan failed` stderr line naming the unresolvable base, prints no clean line, and returns 1
- `runDaemonStoriesRefs` maps a `failed` scan result and any thrown error to that stderr line and exit 1, and prints the clean line only for an `ok` result with zero findings

**Files likely touched:**
- `src/conductor/src/engine/stories-refs-diagnostic.ts` — failed results
- `src/conductor/src/engine/daemon-observe-cli.ts` — failure output and exit code
- `src/conductor/test/engine/daemon-observe-cli.test.ts` — failure tests

**Dependencies:** Task 6

### Task 8: Prove the verb fetches nothing and leaves daemon state, checkout, and refs untouched
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stories-refs-diagnostic.test.ts` and `src/conductor/test/engine/daemon-observe-cli.test.ts` for every Done-when check below. Fixture: an `origin` bare remote fetched once, then `git remote set-url origin` to a nonexistent path; an existing `.daemon/` with a `blocked.json`, a `warned/` marker, and a `processed/` marker; one actionable broken plan; one broken plan with a committed shipped record and no processed marker. Snapshot every file under `.daemon/` (path and bytes), `git status --porcelain`, and `git for-each-ref` before and after running the verb through `dispatchDaemonObserve`.
2. Verify RED where the assertions depend on behavior not yet exercised; if they pass immediately, keep them as regression locks and record that in the commit message.
3. Implement only what the tests require; `src/conductor/src/engine/stories-refs-diagnostic.ts` must call no fetch, `fastForwardRoot`, `writeBlockedSnapshot`, `markWarned`, `repairProcessed`, or `discoverBacklog`.
4. Verify GREEN, commit.

**Done when:**
- [test] In a fixture whose `origin` URL points at a nonexistent path and whose `origin/main` ref was fetched earlier, `dispatchDaemonObserve` for `daemon stories-refs` prints a complete report from the local refs and returns 0
- [test] Over a fixture with an actionable broken plan and an existing `.daemon/` directory, the snapshots of every file under `.daemon/`, `git status --porcelain`, and `git for-each-ref` before and after the run are byte-identical, and no `blocked.json`, `warned/` entry, or `processed/` entry is created or modified
- [test] A broken plan with a committed shipped record and no processed marker is labelled `shipped`, and no `.daemon/processed/<stem>` file exists after the run
- `src/conductor/src/engine/stories-refs-diagnostic.ts` imports and calls none of `fastForwardRoot`, `writeBlockedSnapshot`, `markWarned`, `repairProcessed`, or `discoverBacklog`, and runs no `git fetch`

**Files likely touched:**
- `src/conductor/src/engine/stories-refs-diagnostic.ts` — read-only guarantees
- `src/conductor/test/engine/stories-refs-diagnostic.test.ts` — mutation tests
- `src/conductor/test/engine/daemon-observe-cli.test.ts` — unreachable-origin entry-point test

**Dependencies:** Task 6

## Task Dependency Graph

```
Task 1 ─┐
        ├→ Task 3 → Task 4 → Task 5 → Task 6 → Task 7
Task 2 ─┘                              Task 6 → Task 8
```

## Integration Points

- After Task 2: `discoverBacklog` and the diagnostic share `listBacklogCandidates` and `resolveCandidateStories`; Task 5's parity test proves the two agree over one fixture.
- After Task 6: `ai-conductor daemon stories-refs` runs end to end through the pre-boot observe dispatcher in `index.ts`; Task 6 owns the entry-point integration proof through `detectDaemonObserveCommand` and `dispatchDaemonObserve`, the functions `index.ts` calls.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a committed plan with no feature manifest whose `**Stories:**` line names a well-formed stories path and no file exists at that path in the scanned commit, when the operator runs `ai-conductor daemon stories-refs`, then the report lists that plan's repo-relative path, the raw reference text exactly as written after `**Stories:**`, the attempted path equal to the referenced stories path, and the resolution kind `missing` | 3 | "For a legacy fixture plan whose Stories line names an absent stories file, `scanStoriesRefs`" | diff-local |
| Story 1 happy: Given a committed plan with no feature manifest whose `**Stories:**` value is an absolute path, a path that escapes the repository, or a target that does not end in `.md`, when the operator runs the command, then the report lists that plan with its raw reference text, the attempted path shown as `none`, and the resolution kind `unresolvable` | 3 | "For legacy fixture plans whose Stories value is an absolute path, a path escaping the repository" | diff-local |
| Story 1 happy: Given a committed plan with no feature manifest, no `**Stories:**` line, and no stories file sharing its stem, when the operator runs the command, then the report lists that plan with the raw reference shown as `(no Stories line; same-stem fallback)` and the attempted path equal to the plan's same-stem stories path with kind `missing` | 3 | "a legacy plan with no Stories line and no same-stem stories file renders the reference" | diff-local |
| Story 1 happy: Given a committed feature manifest whose listed plan exists and whose listed stories path is absent from the scanned commit, when the operator runs the command, then the report lists the manifest's plan path, the reference shown as `manifest` followed by the manifest's repo-relative path, the attempted path equal to the listed stories path, and kind `missing`; and when the manifest lists no stories entry, the attempted path is shown as `none` with kind `missing` | 3, 2 | "A manifest-backed fixture whose listed stories path is absent renders the manifest's plan path" | diff-local |
| Story 1 happy: Given a committed feature manifest that fails to parse, when the operator runs the command, then the report lists that feature with the reference shown as `manifest` followed by the manifest's repo-relative path and the parse failure, the attempted path shown as `none`, and kind `malformed-manifest` | 3, 2 | "an unparseable manifest renders `reference: manifest` with the manifest path and parse failure" | diff-local |
| Story 1 negative: Given a committed plan with no feature manifest whose `**Stories:**` line is an inline-code path followed by a trailing annotation (for example a backticked stories path then `(Accepted)`) and that stories file exists at the scanned commit, when the operator runs the command, then that plan does not appear in the report | 3 | "`scanStoriesRefs` returns no finding for a legacy plan whose inline-code Stories path" | diff-local |
| Story 1 negative: Given a committed plan with no feature manifest and no `**Stories:**` line whose same-stem stories file exists at the scanned commit, when the operator runs the command, then that plan does not appear in the report | 3 | "a legacy plan whose same-stem stories file exists" | diff-local |
| Story 1 negative: Given a committed feature manifest whose listed stories file exists at the scanned commit while its plan's `**Stories:**` line is unresolvable, when the operator runs the command, then that feature does not appear in the report, because the manifest is authoritative over the plan's Stories line | 3, 2 | "a manifest-backed spec whose listed stories exist beside an unresolvable plan Stories line" | diff-local |
| Story 1 negative: Given a committed feature manifest whose listed plan is absent from the scanned commit, when the operator runs the command, then that feature does not appear in the report, matching discovery, which does not treat it as a candidate | 3, 2 | "or a manifest whose listed plan is absent" | diff-local |
| Story 2 happy: Given broken-reference plans where one has a `.daemon/processed/<stem>` marker, one has a committed `.docs/shipped/<stem>.md` record, one has a `.daemon/parked/<stem>` marker, one has a `.worktrees/<stem>/.pipeline/HALT` marker without a `.pipeline/DONE` marker, and one has none of these, when the operator runs the command, then those plans are labelled `processed`, `shipped`, `parked`, `halted`, and `actionable` respectively | 4 | "`scanStoriesRefs` labels five broken fixture plans `processed`, `shipped`, `parked`," | diff-local |
| Story 2 happy: Given broken-reference plans in several states, when the report finishes, then it prints a summary giving the total broken count and the count for each of the five states | 4 | "`renderStoriesRefsReport` prints a summary line giving the total broken count and the" | diff-local |
| Story 2 negative: Given a broken-reference plan that is both processed and parked, when the operator runs the command, then it is labelled `processed` only, because states are assigned in the fixed order processed, shipped, parked, halted, actionable and the first match wins | 4 | "A broken plan that is both processed and parked is labelled `processed` only" | diff-local |
| Story 2 negative: Given a broken-reference plan whose feature worktree holds both `.pipeline/HALT` and `.pipeline/DONE`, when the operator runs the command, then it is not labelled `halted` and falls through to the next matching state, matching how the daemon dashboard treats that combination as not halted | 4 | "a broken plan whose worktree holds both `.pipeline/HALT` and `.pipeline/DONE` is labelled `actionable`" | diff-local |
| Story 2 negative: Given the command is run from inside a linked feature worktree rather than the main checkout, when it classifies plans, then it reads the processed and parked markers from the main repository root's `.daemon/` directory and labels a processed plan `processed`, not `actionable` | 4 | "`scanStoriesRefs` given a linked worktree path labels a plan with a main-root" | diff-local |
| Story 3 happy: Given a fixture repository holding legacy and manifest-backed specs in which `discoverBacklog` emits blocked entries with reasons `unresolvable-stories-ref`, `stories-missing`, and `malformed-manifest`, when the operator runs the command against the same repository, then the set of specs it labels `actionable` or `halted` equals the set of slugs discovery blocked for those three reasons (discovery does not skip halted features, so both labels are specs discovery reaches), and each spec's kind matches the corresponding blocked reason | 5 | "The parity test asserts the set of slugs labelled `actionable` or `halted` equals the slugs" | diff-local |
| Story 3 happy: Given a repository whose `origin/<default>` remote-tracking ref is ahead of the local default branch, when the operator runs the command, then it scans the same commit the daemon's discovery pins (the `origin/<default>` tip when that ref exists, otherwise the local default branch) and the report header names that ref and its abbreviated commit id | 5 | "With `origin/main` ahead of local `main`, `scanStoriesRefs` returns `baseSha` equal to" | diff-local |
| Story 3 negative: Given a plan with a broken Stories reference that exists only in the working tree, only as an uncommitted file, or only on an unmerged `spec/<slug>` branch, when the operator runs the command, then that plan does not appear in the report | 5 | "A broken plan that exists only untracked, only staged, or only on an unmerged" | diff-local |
| Story 3 negative: Given a plan whose reference is broken only at the local default branch but fixed at the newer `origin/<default>` tip, when the operator runs the command, then that plan does not appear in the report | 5 | "A plan broken at local `main` but fixed at the newer `origin/main` tip is absent" | diff-local |
| Story 3 negative: Given daemon discovery's candidate listing and Stories resolution after this change, when discovery runs over the existing discovery fixtures, then every existing discovery test passes unchanged, so sharing the resolution with the diagnostic changes no discovery outcome | 2 | "`daemon-backlog-manifest.test.ts`, and `daemon-backlog-applicability.test.ts` pass with no edits" | diff-local |
| Story 4 happy: Given a repository whose committed specs all have resolving Stories references, when the operator runs the command, then it prints the scanned ref and commit, the number of specs scanned, and an explicit line stating that no spec has an unresolvable Stories reference, and exits 0 | 6 | "`dispatchDaemonObserve` for `daemon stories-refs --repo <clean fixture>` prints the" | diff-local |
| Story 4 happy: Given a repository with at least one broken reference, when the operator runs the command, then it prints the findings and the summary and exits 0, because finding broken references is a completed report and not a failure | 6 | "`dispatchDaemonObserve` for `daemon stories-refs --repo <fixture with a broken reference>`" | diff-local |
| Story 4 negative: Given a `--repo` path that is not inside a Git repository, when the operator runs the command, then it writes a line starting `stories-refs: scan failed` with the reason to stderr, prints no clean line and no summary, and exits 1 | 7 | "`dispatchDaemonObserve` for `daemon stories-refs --repo <directory outside any Git repository>`" | diff-local |
| Story 4 negative: Given a repository in which neither `origin/<default>` nor the local default branch resolves to a commit, when the operator runs the command, then it writes a `stories-refs: scan failed` line naming the unresolvable base to stderr and exits 1 without printing a clean line | 7 | "For a fixture repository with no commits, it writes a `stories-refs: scan failed` stderr line" | diff-local |
| Story 4 negative: Given a repository whose scanned commit has no committed plans and no feature manifests, when the operator runs the command, then it reports that 0 specs were scanned at that ref and commit and exits 0, so an empty corpus is stated rather than implied | 6 | "`dispatchDaemonObserve` over a fixture whose scanned commit has no plans and no manifests" | diff-local |
| Story 5 happy: Given a repository whose `origin` remote points at an unreachable location and whose `origin/<default>` ref was fetched earlier, when the operator runs the command, then it completes its report from the local refs and exits 0 | 8 | "In a fixture whose `origin` URL points at a nonexistent path and whose `origin/main` ref" | diff-local |
| Story 5 happy: Given a repository with an existing `.daemon/` directory, when the operator runs the command, then every file under `.daemon/`, the main checkout's `git status --porcelain` output, and every local ref are byte-identical before and after the run | 8 | "Over a fixture with an actionable broken plan and an existing `.daemon/` directory, the" | diff-local |
| Story 5 negative: Given a broken-reference plan whose stem matches a committed shipped record but has no `.daemon/processed/<stem>` marker, when the operator runs the command, then it labels the plan `shipped` and does not write the processed marker that discovery's repair would write | 8 | "A broken plan with a committed shipped record and no processed marker is labelled" | diff-local |
| Story 5 negative: Given an actionable broken-reference plan, when the operator runs the command, then `.daemon/blocked.json` and the `.daemon/warned/` markers are neither created nor modified | 8 | "Over a fixture with an actionable broken plan and an existing `.daemon/` directory, the" | diff-local |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
