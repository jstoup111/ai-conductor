**Status:** Accepted

# Stories: Repo-wide diagnostic for plans whose Stories reference cannot resolve

Source: jstoup111/ai-conductor#1442. Track: technical (no PRD). Tier: S.

Discovery's `BLOCKED` channel (`.daemon/blocked.json`, rendered by `ai-conductor daemon status`)
covers only the last discovery pass, and only specs that are not processed, shipped, or parked.
Answering "which committed specs still have a Stories reference that does not resolve, and which of
them are actionable?" today needs a hand-written script that re-implements the resolver. These
stories add one read-only operator verb, `ai-conductor daemon stories-refs`, that answers it from
the production discovery resolution and lifecycle predicates.

The verb examines exactly the candidates daemon discovery examines: every committed
`.docs/plans/*.md` plan plus every committed feature manifest (`.docs/<slug>/manifest.json`). A
spec's Stories reference "does not resolve" when discovery would block it for that reason:

- **Legacy spec (no manifest).** The plan's `**Stories:**` line is refused by the resolver
  (`unresolvable`), or resolves to a path absent from the scanned commit (`missing`). A plan with
  no `**Stories:**` line uses the resolver's same-stem fallback and is reported when that fallback
  path is absent.
- **Manifest-backed spec.** The manifest is authoritative (`adr-2026-10-24-per-feature-artifact-manifest`
  decision 5): the spec is `missing` when the manifest lists no stories entry or every listed
  stories path is absent, and `malformed-manifest` when the manifest fails to parse. The plan's own
  `**Stories:**` line is not consulted.

## Story 1: The report names every spec whose Stories reference does not resolve

**Requirement:** #1442 desired outcome 1

As an operator, I want one command that lists every committed spec whose Stories reference does not
resolve, with the plan, the raw reference text, and the path that was attempted, so that I can see
the whole problem without writing a scan script.

### Acceptance Criteria

#### Happy Path
- Given a committed plan with no feature manifest whose `**Stories:**` line names a well-formed stories path and no file exists at that path in the scanned commit, when the operator runs `ai-conductor daemon stories-refs`, then the report lists that plan's repo-relative path, the raw reference text exactly as written after `**Stories:**`, the attempted path equal to the referenced stories path, and the resolution kind `missing`
- Given a committed plan with no feature manifest whose `**Stories:**` value is an absolute path, a path that escapes the repository, or a target that does not end in `.md`, when the operator runs the command, then the report lists that plan with its raw reference text, the attempted path shown as `none`, and the resolution kind `unresolvable`
- Given a committed plan with no feature manifest, no `**Stories:**` line, and no stories file sharing its stem, when the operator runs the command, then the report lists that plan with the raw reference shown as `(no Stories line; same-stem fallback)` and the attempted path equal to the plan's same-stem stories path with kind `missing`
- Given a committed feature manifest whose listed plan exists and whose listed stories path is absent from the scanned commit, when the operator runs the command, then the report lists the manifest's plan path, the reference shown as `manifest` followed by the manifest's repo-relative path, the attempted path equal to the listed stories path, and kind `missing`; and when the manifest lists no stories entry, the attempted path is shown as `none` with kind `missing`
- Given a committed feature manifest that fails to parse, when the operator runs the command, then the report lists that feature with the reference shown as `manifest` followed by the manifest's repo-relative path and the parse failure, the attempted path shown as `none`, and kind `malformed-manifest`

#### Negative Paths
- Given a committed plan with no feature manifest whose `**Stories:**` line is an inline-code path followed by a trailing annotation (for example a backticked stories path then `(Accepted)`) and that stories file exists at the scanned commit, when the operator runs the command, then that plan does not appear in the report
- Given a committed plan with no feature manifest and no `**Stories:**` line whose same-stem stories file exists at the scanned commit, when the operator runs the command, then that plan does not appear in the report
- Given a committed feature manifest whose listed stories file exists at the scanned commit while its plan's `**Stories:**` line is unresolvable, when the operator runs the command, then that feature does not appear in the report, because the manifest is authoritative over the plan's Stories line
- Given a committed feature manifest whose listed plan is absent from the scanned commit, when the operator runs the command, then that feature does not appear in the report, matching discovery, which does not treat it as a candidate

### Done When
- [ ] Each reported line carries the plan path, the raw reference text, the attempted path or `none`, and the kind `missing`, `unresolvable`, or `malformed-manifest`, as asserted by a test over a fixture repository containing each broken legacy and manifest-backed shape
- [ ] Specs whose references resolve, including annotated references, the same-stem fallback, and a manifest-listed stories file beside a broken plan Stories line, are absent from the report in the same fixture test

## Story 2: Every reported spec carries its lifecycle state

**Requirement:** #1442 desired outcome 2

As an operator, I want each reported spec labelled processed, shipped, parked, halted, or actionable
so that I can tell finished work with a stale reference from a feature that is genuinely stuck.

### Acceptance Criteria

#### Happy Path
- Given broken-reference plans where one has a `.daemon/processed/<stem>` marker, one has a committed `.docs/shipped/<stem>.md` record, one has a `.daemon/parked/<stem>` marker, one has a `.worktrees/<stem>/.pipeline/HALT` marker without a `.pipeline/DONE` marker, and one has none of these, when the operator runs the command, then those plans are labelled `processed`, `shipped`, `parked`, `halted`, and `actionable` respectively
- Given broken-reference plans in several states, when the report finishes, then it prints a summary giving the total broken count and the count for each of the five states

#### Negative Paths
- Given a broken-reference plan that is both processed and parked, when the operator runs the command, then it is labelled `processed` only, because states are assigned in the fixed order processed, shipped, parked, halted, actionable and the first match wins
- Given a broken-reference plan whose feature worktree holds both `.pipeline/HALT` and `.pipeline/DONE`, when the operator runs the command, then it is not labelled `halted` and falls through to the next matching state, matching how the daemon dashboard treats that combination as not halted
- Given the command is run from inside a linked feature worktree rather than the main checkout, when it classifies plans, then it reads the processed and parked markers from the main repository root's `.daemon/` directory and labels a processed plan `processed`, not `actionable`

### Done When
- [ ] A fixture test asserts the five state labels for five broken plans and the per-state summary counts
- [ ] A fixture test asserts the processed-before-parked precedence and that a HALT accompanied by DONE is not labelled `halted`
- [ ] A test run from a linked worktree path asserts that the main root's processed marker is honoured

## Story 3: The report agrees with what discovery actually does

**Requirement:** #1442 desired outcome 3

As an operator, I want the report computed by the same candidate set, resolution logic, and committed
tree discovery uses so that a report saying "clean" cannot disagree with what the daemon builds.

### Acceptance Criteria

#### Happy Path
- Given a fixture repository holding legacy and manifest-backed specs in which `discoverBacklog` emits blocked entries with reasons `unresolvable-stories-ref`, `stories-missing`, and `malformed-manifest`, when the operator runs the command against the same repository, then the set of specs it labels `actionable` or `halted` equals the set of slugs discovery blocked for those three reasons (discovery does not skip halted features, so both labels are specs discovery reaches), and each spec's kind matches the corresponding blocked reason
- Given a repository whose `origin/<default>` remote-tracking ref is ahead of the local default branch, when the operator runs the command, then it scans the same commit the daemon's discovery pins (the `origin/<default>` tip when that ref exists, otherwise the local default branch) and the report header names that ref and its abbreviated commit id

#### Negative Paths
- Given a plan with a broken Stories reference that exists only in the working tree, only as an uncommitted file, or only on an unmerged `spec/<slug>` branch, when the operator runs the command, then that plan does not appear in the report
- Given a plan whose reference is broken only at the local default branch but fixed at the newer `origin/<default>` tip, when the operator runs the command, then that plan does not appear in the report
- Given daemon discovery's candidate listing and Stories resolution after this change, when discovery runs over the existing discovery fixtures, then every existing discovery test passes unchanged, so sharing the resolution with the diagnostic changes no discovery outcome

### Done When
- [ ] A parity test runs `discoverBacklog` and the diagnostic over one fixture with legacy and manifest-backed specs and asserts the actionable-or-halted set and kinds equal discovery's `unresolvable-stories-ref`, `stories-missing`, and `malformed-manifest` blocked entries
- [ ] A fixture test with `origin/main` ahead of local `main` asserts the scanned commit and the header ref equal what discovery's base resolution returns
- [ ] Uncommitted and spec-branch-only plans are absent from the report in a fixture test
- [ ] The existing discovery test files pass unchanged against the shared resolution

## Story 4: A clean report is distinguishable from a report that failed to run

**Requirement:** #1442 desired outcome 4

As an operator, I want a clean repository to say so explicitly, and a failed scan to say it failed,
so that silence or an empty list is never mistaken for a clean bill of health.

### Acceptance Criteria

#### Happy Path
- Given a repository whose committed specs all have resolving Stories references, when the operator runs the command, then it prints the scanned ref and commit, the number of specs scanned, and an explicit line stating that no spec has an unresolvable Stories reference, and exits 0
- Given a repository with at least one broken reference, when the operator runs the command, then it prints the findings and the summary and exits 0, because finding broken references is a completed report and not a failure

#### Negative Paths
- Given a `--repo` path that is not inside a Git repository, when the operator runs the command, then it writes a line starting `stories-refs: scan failed` with the reason to stderr, prints no clean line and no summary, and exits 1
- Given a repository in which neither `origin/<default>` nor the local default branch resolves to a commit, when the operator runs the command, then it writes a `stories-refs: scan failed` line naming the unresolvable base to stderr and exits 1 without printing a clean line
- Given a repository whose scanned commit has no committed plans and no feature manifests, when the operator runs the command, then it reports that 0 specs were scanned at that ref and commit and exits 0, so an empty corpus is stated rather than implied

### Done When
- [ ] Tests assert the clean output and exit 0, the findings output and exit 0, and the zero-specs output naming the ref and commit
- [ ] Tests assert that a non-repository path and an unresolvable base each produce a `stories-refs: scan failed` stderr line, no clean line, and exit 1

## Story 5: The invocation makes no network calls and mutates nothing

**Requirement:** #1442 desired outcome 5

As an operator, I want to run the diagnostic at any time, including while the daemon is running,
without it fetching, writing daemon state, or touching the checkout.

### Acceptance Criteria

#### Happy Path
- Given a repository whose `origin` remote points at an unreachable location and whose `origin/<default>` ref was fetched earlier, when the operator runs the command, then it completes its report from the local refs and exits 0
- Given a repository with an existing `.daemon/` directory, when the operator runs the command, then every file under `.daemon/`, the main checkout's `git status --porcelain` output, and every local ref are byte-identical before and after the run

#### Negative Paths
- Given a broken-reference plan whose stem matches a committed shipped record but has no `.daemon/processed/<stem>` marker, when the operator runs the command, then it labels the plan `shipped` and does not write the processed marker that discovery's repair would write
- Given an actionable broken-reference plan, when the operator runs the command, then `.daemon/blocked.json` and the `.daemon/warned/` markers are neither created nor modified

### Done When
- [ ] A fixture test with an unreachable `origin` URL completes with exit 0
- [ ] A fixture test snapshots `.daemon/`, `git status --porcelain`, and `git for-each-ref` before and after the run and asserts they are identical, including no new `blocked.json`, `warned/`, or `processed/` entries
