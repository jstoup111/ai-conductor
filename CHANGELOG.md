# Changelog

All notable changes to this harness are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release cadence: this file and `VERSION` are written only by the bot-owned
`automation/release-pr` pull request, which renders them from the `Release-*`
metadata each merged implementation PR declares in its body. Implementation
branches never edit either file (see `docs/contributing/releases.md`).

## [Unreleased]

## [0.104.0] - 2026-08-19

### Added

- Task-attributed commits are checked against the active task's declared files at commit time, with violations and accepted scope widenings carried into build_review evidence. ([implementation PR #1534](https://github.com/jstoup111/ai-conductor/pull/1534)).
- Self-host dispatches now prove the live checkout is read-only with a two-sided bwrap probe, so concurrent operator edits during a contained build no longer halt the run; unproven or opted-out dispatches keep the prior fail-closed behavior. ([implementation PR #1698](https://github.com/jstoup111/ai-conductor/pull/1698)).

### Changed

- Story artifacts under `.docs/stories/` are now corrected in place during DECIDE instead of accumulating additive amendment blocks; all other accepted DECIDE artifacts keep the additive-amendment rule. ([implementation PR #1539](https://github.com/jstoup111/ai-conductor/pull/1539)).
- Acceptance-spec authoring is disposition-driven — criteria proven at a lower layer complete the acceptance_specs gate with grounded disposition records instead of fabricated specs, and BUILD prefers applicable local patterns. ([implementation PR #1678](https://github.com/jstoup111/ai-conductor/pull/1678)).

### Fixed

- The FINISH publication retry budget no longer exhausts on verified transitions, and new halt reasons name a stuck PR-state check or an unmoved publication transition. ([implementation PR #1565](https://github.com/jstoup111/ai-conductor/pull/1565)).
- The tautology rubric's counterfactual checkout now resolves the conductor's dependency installation, so changed suites execute instead of aborting at import. ([implementation PR #1699](https://github.com/jstoup111/ai-conductor/pull/1699)).
- The opt-in Tautology build-review rubric now classifies counterfactual test runs by process exit code instead of parsing Vitest/pytest-shaped output, so it returns a real verdict on RSpec and other frameworks instead of always reporting an infrastructure failure. ([implementation PR #1705](https://github.com/jstoup111/ai-conductor/pull/1705)).
- `conduct --update`/`bin/update` now detect the real installed release from the checkout instead of misreporting an off-tag tagged-channel install as permanently up to date. ([implementation PR #1578](https://github.com/jstoup111/ai-conductor/pull/1578)).
- Fixed a stale manual-test verdict discovered at FINISH becoming unroutable, so the daemon no longer stalls on that SHIP validator instead of routing it back for retry. ([implementation PR #1673](https://github.com/jstoup111/ai-conductor/pull/1673)).
- Provider token telemetry now reports fresh input consistently across Claude and Codex, with cached prompt volume shown separately in daemon logs and feature usage totals. ([implementation PR #1689](https://github.com/jstoup111/ai-conductor/pull/1689)).
- Codex usage-cap exhaustion is now reported as usage exhaustion with an hour-scale wait instead of a misleading 300-second rate-limit retry loop. ([implementation PR #1704](https://github.com/jstoup111/ai-conductor/pull/1704)).
- build_review finding identities are content-anchored, so re-worded findings can no longer escape their accepted dispositions across review laps. ([implementation PR #1696](https://github.com/jstoup111/ai-conductor/pull/1696)).
- Self-host containment refuses itself on hosts where the wrap would deny a provider its own nested sandbox, instead of wrapping a dispatch that cannot write any file. ([implementation PR #1719](https://github.com/jstoup111/ai-conductor/pull/1719)).
- A concurrent provider process's plugin lock markers no longer halt a self-host build. ([implementation PR #1722](https://github.com/jstoup111/ai-conductor/pull/1722)).
- Shipped-record timing now reaches the `measured` state instead of getting stuck at `partial`/`unavailable`, and a `partial` state's `## Time` block now names its downgrade reason. ([implementation PR #1727](https://github.com/jstoup111/ai-conductor/pull/1727)).
- A build_review pass no longer resets the cumulative kickback convergence cap by itself; the cap is credited back only when a rebase actually invalidates a judged build_review, closing a loophole that let build_review cycle indefinitely across passes. ([implementation PR #1728](https://github.com/jstoup111/ai-conductor/pull/1728)).

## [0.103.0] - 2026-08-17

### Added

- Plan tasks can now declare a `Preserves:` behavior clause, and build-review's Completeness gate recognizes when a preserved behavior's coverage survives a relocation or refactor instead of flagging it as a regression. ([implementation PR #1656](https://github.com/jstoup111/ai-conductor/pull/1656)).
- Daemon-managed provider sessions can no longer invoke conduct-ts orchestration commands; only session-sanctioned worker subcommands are permitted. ([implementation PR #1599](https://github.com/jstoup111/ai-conductor/pull/1599)).

### Changed

- The build_review tautology rubric is now opt-in (`build_review.rubrics.tautology.enabled: true`) because its scoped-run preflight only recognizes Vitest/pytest output; on other frameworks it could never return a verdict and deadlocked the gate. ([implementation PR #1684](https://github.com/jstoup111/ai-conductor/pull/1684)).

### Fixed

- Remediation tasks now reach the builder on daemon features whose specs were authored externally — the plan-append no longer silently no-ops when engine-state.json is absent. ([implementation PR #1671](https://github.com/jstoup111/ai-conductor/pull/1671)).
- The engine now commits its own remediation plan appends, and build completion refuses to pass while an engine-appended rem-* task heading is missing from the plan. ([implementation PR #1675](https://github.com/jstoup111/ai-conductor/pull/1675)).
- Seal rotation accepts the engine's own recorded remediation-task plan appends instead of halting for a manual reseal. ([implementation PR #1679](https://github.com/jstoup111/ai-conductor/pull/1679)).
- build_review completeness judges remediation-authored repairs against their own task text instead of regenerating scope from them each lap. ([implementation PR #1681](https://github.com/jstoup111/ai-conductor/pull/1681)).

## [0.102.0] - 2026-08-16

### Added

- A plan can declare that a task replicates an existing source file under a rename map, and BUILD mechanically copies and verifies that replication with a new blocking `build_review` gate instead of relying on an LLM to reproduce it from scratch. ([implementation PR #1451](https://github.com/jstoup111/ai-conductor/pull/1451)).
- Add a `conduct-ts build-tail` rollup command and pipeline closeout-event telemetry that decompose build-step timing into task execution, remediation, and closeout, surfaced in the terminal UI and OTel export. ([implementation PR #1395](https://github.com/jstoup111/ai-conductor/pull/1395)).
- Operators can now run `conduct-ts reseal` from an interactive terminal to re-fingerprint approved, amended protected DECIDE artifacts, with every reseal and refusal recorded in the audit trail. ([implementation PR #1454](https://github.com/jstoup111/ai-conductor/pull/1454)).
- conflict-check and coherence-check now detect and block contradictions between approved ADRs and stories before they reach BUILD, with the ADR corpus scoped by the new `conflict_check.adr_corpus` config key (default `change_set`, or `repo_wide` to compare against every approved decision). ([implementation PR #1453](https://github.com/jstoup111/ai-conductor/pull/1453)).
- build_review's grader now sees and judges operator-authorized protected-artifact reseal rationale instead of grading the diff blind to it. ([implementation PR #1556](https://github.com/jstoup111/ai-conductor/pull/1556)).
- Split `build_review` into four independently configurable rubrics (tautology, scope, root cause, completeness) that run concurrently, retire the wiring rubric, and let an operator accept one specific finding with a mandatory rationale via `conduct-ts build-review findings` and `accept` so it no longer blocks later review laps. ([implementation PR #1563](https://github.com/jstoup111/ai-conductor/pull/1563)).

### Changed

- Unattended runs now use the daemon while foreground auto mode exits with migration guidance. ([implementation PR #1509](https://github.com/jstoup111/ai-conductor/pull/1509)).
- The daemon dashboard now shows dispatch elapsed time, last test outcome, and acceptance-spec RED-evidence status for in-progress features, and acceptance-spec RED evidence records failing-test identity and provenance so remediations can be verified or explicitly waived. ([implementation PR #1485](https://github.com/jstoup111/ai-conductor/pull/1485)).
- build_review rubric branches now carry weighted default efforts (rootCause medium, others high); explicit rubric or step config overrides. ([implementation PR #1591](https://github.com/jstoup111/ai-conductor/pull/1591)).
- The tdd skill now scopes RED cycles away from removals and requires a pre-diff failure check before a task commits a new or changed test. ([implementation PR #1633](https://github.com/jstoup111/ai-conductor/pull/1633)).

### Deprecated

- Deprecates the per-task Wired-into contract layer in favor of the build_review wiring rubric while retaining compatibility for existing plan annotations and wiring_check state. ([implementation PR #1517](https://github.com/jstoup111/ai-conductor/pull/1517)).

### Removed

- build_review no longer judges wiring reachability. The gate scores four rubric items (tautology, scope, root cause, completeness); the retired `wiring` verdict and config keys are ignored rather than rejected, so in-flight verdicts and existing consumer configs keep working. ([implementation PR #1577](https://github.com/jstoup111/ai-conductor/pull/1577)).

### Fixed

- Spec PRs opened into a repository that requires a release disposition now always declare one, so its required release-metadata check no longer fails on every landed spec. ([implementation PR #1448](https://github.com/jstoup111/ai-conductor/pull/1448)).
- `Wired-into:` inert waivers accept `Task N` (a task in the same plan) and bare `#N` issue refs, and an unrecognized ref is now rejected at authoring time instead of failing the build as a missing file. ([implementation PR #1469](https://github.com/jstoup111/ai-conductor/pull/1469)).
- Self-host builds no longer halt when a concurrent Codex session opens or closes a thread, which wrote transient lock files into the fingerprinted provider-state directory. ([implementation PR #1470](https://github.com/jstoup111/ai-conductor/pull/1470)).
- A rebase that only pulls in unrelated base-branch changes no longer discards the build_review verdict, cutting the harness's largest LLM cost; the feature's own code or tests still re-open it. ([implementation PR #1473](https://github.com/jstoup111/ai-conductor/pull/1473)).
- The daemon repairs a feature's retained PR after a transient HALT instead of leaving it stuck as an unrecoverable "needs-remediation" placeholder. ([implementation PR #1468](https://github.com/jstoup111/ai-conductor/pull/1468)).
- Finish no longer halts with "release metadata is malformed or non-canonical" when its publication spans more than one dispatch. ([implementation PR #1499](https://github.com/jstoup111/ai-conductor/pull/1499)).
- The prd_audit gate now fails closed when the audit report is missing a verdict row for any functional requirement in the feature's approved PRD, instead of passing on a partial report. ([implementation PR #1457](https://github.com/jstoup111/ai-conductor/pull/1457)).
- Protected artifact seal rotation no longer refuses when a base-ahead path was never touched by the feature, avoiding false "seal rebaseline refused" halts. ([implementation PR #1498](https://github.com/jstoup111/ai-conductor/pull/1498)).
- `conduct-ts scoped-run` now runs in `test_suite.working_directory` and rebases project-root-relative selectors onto it, so scoped test runs work in monorepo layouts. ([implementation PR #1520](https://github.com/jstoup111/ai-conductor/pull/1520)).
- A rebase no longer halts for human review when a feature commit is dropped because the base already landed an equivalent change. ([implementation PR #1544](https://github.com/jstoup111/ai-conductor/pull/1544)).
- build_review now terminates in an operator-visible halt after a bounded number of cumulative kickbacks instead of churning indefinitely, and no longer grades removal maintenance as a tautology. ([implementation PR #1526](https://github.com/jstoup111/ai-conductor/pull/1526)).
- build_review no longer flags diff-required fixture relocations as Tautology failures when a production hunk in the same diff forces the path move. ([implementation PR #1546](https://github.com/jstoup111/ai-conductor/pull/1546)).
- build_review no longer flags diff-required fixture relocations as Tautology failures when a production hunk in the same diff forces the path move. ([implementation PR #1549](https://github.com/jstoup111/ai-conductor/pull/1549)).
- Rebase-invalidated test failures are now durably matched to the base advance that caused them via the event spine, so build_review reliably receives repair context instead of losing it to an overwritten transient signal. ([implementation PR #1543](https://github.com/jstoup111/ai-conductor/pull/1543)).
- Self-host daemon runs now sweep and reclaim leaked provider scratch homes left behind by abruptly interrupted attempts, instead of leaving them to accumulate. ([implementation PR #1495](https://github.com/jstoup111/ai-conductor/pull/1495)).
- Build reviews now give actionable retry feedback when a PASS verdict contradicts its rubric flags. ([implementation PR #1560](https://github.com/jstoup111/ai-conductor/pull/1560)).
- Fix build reviews that repeatedly halt after a clean pass because rubric booleans are inverted. ([implementation PR #1562](https://github.com/jstoup111/ai-conductor/pull/1562)).
- PRD audit now resolves date-prefixed PRD filenames for the active feature. ([implementation PR #1566](https://github.com/jstoup111/ai-conductor/pull/1566)).
- Spec and implementation PRs no longer fail the release-metadata check when their issue-linking trailer follows a trailing Migration section. ([implementation PR #1569](https://github.com/jstoup111/ai-conductor/pull/1569)).
- Fresh installs and updates now follow a stable branch that advances only after a release is fully published. ([implementation PR #1561](https://github.com/jstoup111/ai-conductor/pull/1561)).
- `remediate` now routes a build_review gap to `build` when an existing approved-plan task already admits the fix, instead of incorrectly halting for a needless re-plan. ([implementation PR #1571](https://github.com/jstoup111/ai-conductor/pull/1571)).
- An operator-authorized protected-artifact reseal now survives later seal rebaselining, instead of halting the feature every time its base branch moves. ([implementation PR #1576](https://github.com/jstoup111/ai-conductor/pull/1576)).
- build_review's tautology preflight counts a reverted-tree test collection failure as RED instead of infrastructure, and rubric sessions' JSON verdicts parse through prose or markdown wrapping. ([implementation PR #1593](https://github.com/jstoup111/ai-conductor/pull/1593)).
- build_review rubric sessions receive the changed-file list and hunk line ranges instead of the full embedded diff, reading the worktree directly — cutting per-branch prompt size ~95% and stabilizing grader output on large diffs. ([implementation PR #1595](https://github.com/jstoup111/ai-conductor/pull/1595)).
- Provider sessions are always fresh — the adapters replace any supplied session id and strip resume flags unconditionally, so no call path can resume a prior conversation. ([implementation PR #1596](https://github.com/jstoup111/ai-conductor/pull/1596)).
- build_review tautology prompts are bounded by construction (path manifest + closed run verdict instead of embedded file contents and raw test output), fixing prompt-too-long failures on large features. ([implementation PR #1600](https://github.com/jstoup111/ai-conductor/pull/1600)).
- build_review rubric dispatches enforce the judged-result schema with a bounded in-dispatch repair, and kickback routing honors operator dispositions recorded after aggregate composition. ([implementation PR #1605](https://github.com/jstoup111/ai-conductor/pull/1605)).
- `build_review`'s rubric cache no longer misses on every rebase — a rebase that leaves diff and plan content unchanged now reuses prior rubric judgements instead of re-judging all four branches. ([implementation PR #1601](https://github.com/jstoup111/ai-conductor/pull/1601)).
- The Tautology build-review gate no longer blocks a build when a plan task is correctly declared verify-only and its changed test does not assert new behavior. ([implementation PR #1618](https://github.com/jstoup111/ai-conductor/pull/1618)).
- Loop halts, rebase-conflict halts, and failed halt-marker writes now persist to `.pipeline/events.jsonl`, so a halt is reconstructable from the audit ledger alone. ([implementation PR #1519](https://github.com/jstoup111/ai-conductor/pull/1519)).
- The tautology preflight now reverts renamed files in its counterfactual instead of discarding its mechanical evidence for the whole lap. ([implementation PR #1632](https://github.com/jstoup111/ai-conductor/pull/1632)).
- Remediation repairs now carry pointers to the governing plan task and prior same-anchor attempts, instead of being dispatched blind to the plan contract. ([implementation PR #1637](https://github.com/jstoup111/ai-conductor/pull/1637)).
- Intake commands now fail closed with a clear error and an untouched ledger when the intake ledger is corrupt, instead of risking silent data loss. ([implementation PR #1541](https://github.com/jstoup111/ai-conductor/pull/1541)).
- Claude usage lines now count cached input, so per-dispatch and feature token totals reflect real prompt volume. ([implementation PR #1641](https://github.com/jstoup111/ai-conductor/pull/1641)).
- FINISH prose judgments persist per revision, so resumed publications re-observe accepted prose instead of paying a new judgment attempt. ([implementation PR #1653](https://github.com/jstoup111/ai-conductor/pull/1653)).
- The release gate no longer rejects a valid Migration section when the draft PR's unreplaced Closes placeholder comment follows it. ([implementation PR #1658](https://github.com/jstoup111/ai-conductor/pull/1658)).
- Release-PR maintenance no longer wedges when a prior release PR merged but its publication failed. ([implementation PR #1662](https://github.com/jstoup111/ai-conductor/pull/1662)).
- Release renders now base the next version on the last published tag, so failed publishes no longer consume version numbers or leave phantom changelog sections. ([implementation PR #1665](https://github.com/jstoup111/ai-conductor/pull/1665)).

### Security

- Shipped records and retained PR bodies list accepted build-review findings by id only; summaries, rationales, operator identity, and timestamps stay in the local disposition store. ([implementation PR #1615](https://github.com/jstoup111/ai-conductor/pull/1615)).

## Migration

```bash migration
# The `conduct-ts validate-wired-into <plan>` subcommand no longer exists.
# Remove any script, CI step, or pre-plan hook that invokes it directly:
#   conduct-ts validate-wired-into <plan-file-path> [--cwd <dir>]
#
# Plans no longer need `**Wired-into:**` task annotations — the engineer
# step and land no longer parse or require them. Existing plans that still
# carry the annotation are unaffected; new plans can omit it.
#
# No config file changes are required: `wiring.entry_points` in
# .ai-conductor/config.yml keeps its existing shape and is now consumed by
# the build_review wiring rubric prompt instead of the retired import-graph
# probe.
```

```bash migration
"$HARNESS_DIR/bin/install" --update
```

## Migration

```bash migration
# The `conduct-ts validate-wired-into <plan>` subcommand no longer exists.
# Remove any script, CI step, or pre-plan hook that invokes it directly:
#   conduct-ts validate-wired-into <plan-file-path> [--cwd <dir>]
#
# Plans no longer need `**Wired-into:**` task annotations — the engineer
# step and land no longer parse or require them. Existing plans that still
# carry the annotation are unaffected; new plans can omit it.
#
# No config file changes are required: `wiring.entry_points` in
# .ai-conductor/config.yml keeps its existing shape and is now consumed by
# the build_review wiring rubric prompt instead of the retired import-graph
# probe.
```

```bash migration
"$HARNESS_DIR/bin/install" --update
```

## Migration

```bash migration
# The `conduct-ts validate-wired-into <plan>` subcommand no longer exists.
# Remove any script, CI step, or pre-plan hook that invokes it directly:
#   conduct-ts validate-wired-into <plan-file-path> [--cwd <dir>]
#
# Plans no longer need `**Wired-into:**` task annotations — the engineer
# step and land no longer parse or require them. Existing plans that still
# carry the annotation are unaffected; new plans can omit it.
#
# No config file changes are required: `wiring.entry_points` in
# .ai-conductor/config.yml keeps its existing shape and is now consumed by
# the build_review wiring rubric prompt instead of the retired import-graph
# probe.
```

```bash migration
"$HARNESS_DIR/bin/install" --update
```

## Migration

```bash migration
# The `conduct-ts validate-wired-into <plan>` subcommand no longer exists.
# Remove any script, CI step, or pre-plan hook that invokes it directly:
#   conduct-ts validate-wired-into <plan-file-path> [--cwd <dir>]
#
# Plans no longer need `**Wired-into:**` task annotations — the engineer
# step and land no longer parse or require them. Existing plans that still
# carry the annotation are unaffected; new plans can omit it.
#
# No config file changes are required: `wiring.entry_points` in
# .ai-conductor/config.yml keeps its existing shape and is now consumed by
# the build_review wiring rubric prompt instead of the retired import-graph
# probe.
```

```bash migration
"$HARNESS_DIR/bin/install" --update
```

## Migration

```bash migration
# The `conduct-ts validate-wired-into <plan>` subcommand no longer exists.
# Remove any script, CI step, or pre-plan hook that invokes it directly:
#   conduct-ts validate-wired-into <plan-file-path> [--cwd <dir>]
#
# Plans no longer need `**Wired-into:**` task annotations — the engineer
# step and land no longer parse or require them. Existing plans that still
# carry the annotation are unaffected; new plans can omit it.
#
# No config file changes are required: `wiring.entry_points` in
# .ai-conductor/config.yml keeps its existing shape and is now consumed by
# the build_review wiring rubric prompt instead of the retired import-graph
# probe.
```

```bash migration
"$HARNESS_DIR/bin/install" --update
```

## [0.101.1] - 2026-08-10

### Fixed

- A legacy-JSON seeding failure no longer disables the harness update check when the schema-owned conductor config is readable. ([implementation PR #1464](https://github.com/jstoup111/ai-conductor/pull/1464)).

## [0.101.0] - 2026-08-10

### Added

- `conduct-ts validate-wired-into <plan>` resolves a plan's **Wired-into:** anchors at DECIDE time through the same machinery BUILD-time completion verification uses, and exits 1 on any anchor that cannot resolve. ([implementation PR #1190](https://github.com/jstoup111/ai-conductor/pull/1190)).
- conflict-check detects oscillating requirements — pairs that are individually satisfiable but mutually exclusive, which send work round a non-terminating kickback loop. coherence-check gains a `fail` verdict and a consistency pass for cross-layer contradictions that coverage alone cannot express. ([implementation PR #1394](https://github.com/jstoup111/ai-conductor/pull/1394)).
- The release-metadata check now labels each PR with the semver impact it declares (semver:major/minor/patch), so merge order is readable from the PR list. ([implementation PR #1405](https://github.com/jstoup111/ai-conductor/pull/1405)).
- Worktrees now get a preventive pre-commit hook that blocks commits touching another feature's sealed DECIDE artifacts (`.docs/architecture`, `.docs/decisions`, `.docs/plans`, `.docs/specs`, `.docs/stories`) during BUILD/SHIP, and remediation gaps that target a sealed artifact are now redirected to the owning DECIDE step. ([implementation PR #1396](https://github.com/jstoup111/ai-conductor/pull/1396)).
- The daemon, spec authoring, and spec landing now refuse to dispatch or land work whose ADRs are not declared APPROVED or SUPERSEDED, closing the gap where a merged spec with an unapproved architecture decision could still reach build. ([implementation PR #1384](https://github.com/jstoup111/ai-conductor/pull/1384)).
- Spec and implementation PRs now inherit the originating issue's `priority:` criticality labels. ([implementation PR #1440](https://github.com/jstoup111/ai-conductor/pull/1440)).

### Changed

- The validation-phase fan-out now defaults to 4, so the SHIP-tail group (manual test, PRD audit, as-built architecture review) dispatches in a single wave instead of two. ([implementation PR #1413](https://github.com/jstoup111/ai-conductor/pull/1413)).

### Fixed

- The land-time coherence gate now checks that stories tie out to the PRD in both directions — a story citing a requirement the PRD never declares, or citing none at all, is reported as a gap. Plan `Wired-into:` anchors are now validated as a blocking gate at every tier instead of by an optional command, and the plan skill judges the residue the matcher cannot decide: an anchor into a file the same task creates, or one whose match is an import, comment, or re-export rather than a call. ([implementation PR #1401](https://github.com/jstoup111/ai-conductor/pull/1401)).
- A pull request whose `## Migration` section is its last section no longer fails its own release gate at finish; the release metadata block below it is parsed correctly instead of being swallowed into the migration content. ([implementation PR #1404](https://github.com/jstoup111/ai-conductor/pull/1404)).
- A pull request whose `## Migration` section sits above its release metadata block, or is followed by a trailer, no longer fails the finish-time release gate as non-canonical, and the merged body no longer duplicates the Migration section. ([implementation PR #1406](https://github.com/jstoup111/ai-conductor/pull/1406)).
- `conduct-ts shipped-record` reports success on stdout, so a successful ship no longer appears in the daemon log tagged `[error]`. ([implementation PR #1407](https://github.com/jstoup111/ai-conductor/pull/1407)).
- build_review now treats prior wiring_check gate instructions recorded in the event ledger as evidence when grading scope, so plan hunks that implement a gate-mandated fix are no longer wrongly flagged as out-of-plan work. ([implementation PR #1452](https://github.com/jstoup111/ai-conductor/pull/1452)).
- Update checks now use the schema-owned conductor configuration and automatically migrate supported legacy preferences. ([implementation PR #1412](https://github.com/jstoup111/ai-conductor/pull/1412)).
- The remediate step may now amend a plan in response to a blocking gate; the build step still may not. ([implementation PR #1459](https://github.com/jstoup111/ai-conductor/pull/1459)).
- wiring_check no longer treats a Markdown or .docs/ mention of a symbol as a production reference, so a task declared inert is no longer flagged stale against its own plan document. ([implementation PR #1460](https://github.com/jstoup111/ai-conductor/pull/1460)).

### Security

- Intake filing now redacts credentials and operator-identifying paths from the issue title and body before publishing, and reports what it replaced. ([implementation PR #1420](https://github.com/jstoup111/ai-conductor/pull/1420)).
- The daemon's DECIDE-entry grant is now stored outside the feature worktree so a build agent can no longer authorize its own DECIDE entry, and the `plan` step can never be granted at all. ([implementation PR #1403](https://github.com/jstoup111/ai-conductor/pull/1403)).

## Migration

```bash migration
# The engine now installs a third, fail-closed worktree git hook (pre-commit)
# that rejects staged commits under protected .docs/ artifact directories
# during BUILD/SHIP. It is generated fresh into <worktree>/.pipeline/git-hooks/
# only when a worktree is (re)prepared, so already-prepared, in-flight
# worktrees do not pick it up automatically. Recreate each affected worktree
# from its branch (the branch is the source of truth) so the daemon
# re-provisions it with the new hook:

conduct-ts daemon park <slug>
rm -rf .worktrees/<slug>
conduct-ts daemon unpark <slug>
# The daemon recreates the worktree on its next dispatch, running
# prepareWorktree and installing pre-commit/prepare-commit-msg/commit-msg
# together. No action is needed for worktrees created after this change ships.
```

```bash migration
# The DECIDE grant moved out of the feature worktree into the daemon-owned store.
# Any grant still pending in a worktree is now inert; move it, or drop it if stale.
# Grants naming `plan` are no longer honored and are removed rather than migrated.
set -euo pipefail
mkdir -p .daemon/grants
for grant in .worktrees/*/.pipeline/decide-grant.json; do
  [ -e "$grant" ] || continue
  slug=$(basename "$(dirname "$(dirname "$grant")")")
  if grep -q '"step"[[:space:]]*:[[:space:]]*"plan"' "$grant"; then
    echo "dropping ungrantable plan grant for ${slug}"
  else
    echo "migrating grant for ${slug} -> .daemon/grants/${slug}.json"
    cp "$grant" ".daemon/grants/${slug}.json"
  fi
  rm -f "$grant"
done
```

```bash migration
"${HARNESS_DIR:?HARNESS_DIR must be set by bin/migrate}/bin/update" --auto
```

## [0.100.0] - 2026-08-07

### Added

- Plan authoring and land now block a task that would hand BUILD a mutation to another feature's sealed DECIDE artifact, routing that amendment back to its owning DECIDE step instead. ([implementation PR #1303](https://github.com/jstoup111/ai-conductor/pull/1303)).
- The self-host version freeze can track a branch's current VERSION via "latest" or "branch:<name>" instead of only a pinned semver string. ([implementation PR #1058](https://github.com/jstoup111/ai-conductor/pull/1058)).
- The daemon dashboard now shows a NEVER-STARTED section for worktrees with no pipeline state, distinguishes retained-worktree exclusion reasons (open/closed/unknown PR state, missing PR reference), and prints a concrete remedy for every excluded row. ([implementation PR #1338](https://github.com/jstoup111/ai-conductor/pull/1338)).
- The daemon now refuses to re-dispatch a build after a wiring-check kickback that would repeat an already-observed no-op build cycle, halting immediately instead of burning a turn, and annotates build completion log lines with the observed tree-hash movement. ([implementation PR #1350](https://github.com/jstoup111/ai-conductor/pull/1350)).

### Changed

- The rebase skill now verifies replay intent against source and upstream commits, halts on the first semantic ambiguity, and reconciles every rebased commit against that captured intent before reporting success. ([implementation PR #1292](https://github.com/jstoup111/ai-conductor/pull/1292)).
- Claude autonomous and interactive defaults now use Opus instead of Fable while retaining Fable for escalation and availability fallback. ([implementation PR #1327](https://github.com/jstoup111/ai-conductor/pull/1327)).

### Fixed

- The wiring gate now accepts inert waiver refs wrapped in Markdown inline code, instead of failing with "inert waiver ref not found" for a file that exists. ([implementation PR #1276](https://github.com/jstoup111/ai-conductor/pull/1276)).
- The bot-owned release PR now opens on repositories that squash- or rebase-merge; its candidate range no longer required merge commits. ([implementation PR #1278](https://github.com/jstoup111/ai-conductor/pull/1278)).
- A self-host build no longer halts when the ship-start push fails but its draft PR is already open — the release gate resolves the retained PR from the feature branch, and still halts fail-closed when no open PR exists. ([implementation PR #1290](https://github.com/jstoup111/ai-conductor/pull/1290)).
- The remediation planner no longer falsely halts for a human architecture decision when a gap is conforming implementation, test, or documentation drift that preserves already-approved architecture — it now routes that work straight to build, and the daemon halts with a clear reason instead of silently dispatching a taskless build route. ([implementation PR #1283](https://github.com/jstoup111/ai-conductor/pull/1283)).
- Build repair now re-verifies every non-skipped BUILD member after a kickback instead of trusting a stale on-disk verdict, so a passing member the gate check reads as unsatisfied no longer blocks the run in a terminal-less park. ([implementation PR #1291](https://github.com/jstoup111/ai-conductor/pull/1291)).
- A SHIP step that runs before finish now reads a presentable implementation PR instead of a reused needs-remediation halt placeholder, so a feature that halted earlier no longer stalls its pre-finish ship gates. ([implementation PR #1304](https://github.com/jstoup111/ai-conductor/pull/1304)).
- FINISH now converges deterministically through an engine-owned publication coordinator instead of spending minutes retrying non-deterministic provider judgment. ([implementation PR #1295](https://github.com/jstoup111/ai-conductor/pull/1295)).
- The SHIP draft PR now opens with the real PR body template; a placeholder-body finish refusal re-dispatches finish for a body rewrite instead of re-running the build; /remediate gains a publication disposition that never amends the plan; and the rebase is no longer skipped on textual mergeability when the base has moved in code or was resolved from a degraded local fallback. ([implementation PR #1316](https://github.com/jstoup111/ai-conductor/pull/1316)).
- The daemon no longer silently discards an out-of-process edit to conduct-state.json when it writes state next; conflicting field writes are now detected and surfaced instead of one side winning silently. ([implementation PR #1305](https://github.com/jstoup111/ai-conductor/pull/1305)).
- Restored the engine build after a semantic merge conflict left two undefined `writeState` calls on the finish publication-defect path, which halted every newly dispatched feature at setup. ([implementation PR #1320](https://github.com/jstoup111/ai-conductor/pull/1320)).
- FINISH no longer halts a feature that legitimately skipped a SHIP step; a skipped step now counts as resolved evidence rather than missing evidence. ([implementation PR #1322](https://github.com/jstoup111/ai-conductor/pull/1322)).
- FINISH now records the publication outcome instead of exhausting its retry budget — the coordinator was handing finish-record a fail-closed no-op instead of the real gh/git runners. ([implementation PR #1323](https://github.com/jstoup111/ai-conductor/pull/1323)).
- FINISH now publishes the rebased feature branch with a lease-protected push instead of halting on a rejected plain push, and halts immediately — with an explanation — on a publication reason no retry could ever satisfy, rather than spending the whole retry budget first. ([implementation PR #1326](https://github.com/jstoup111/ai-conductor/pull/1326)).
- The daemon no longer halts a build when a branch has simply fallen behind a protected artifact it never touched, and halt reasons for protected-artifact violations now name the specific cause (uncommitted edit, feature-authored change, or undeterminable provenance) with a recovery step. ([implementation PR #1321](https://github.com/jstoup111/ai-conductor/pull/1321)).
- `bin/migrate` now correctly and safely applies every pending migration when a consumer project jumps multiple releases at once, instead of only the latest. ([implementation PR #1325](https://github.com/jstoup111/ai-conductor/pull/1325)).
- The build step no longer reports itself complete or routes an exhausted build through commit-movement while the worktree has uncommitted paths — the halt now names the dirty paths so they can be committed or discarded first. ([implementation PR #1312](https://github.com/jstoup111/ai-conductor/pull/1312)).
- The wiring reachability gate no longer flags test-only exported helpers as unwired production surface. ([implementation PR #1334](https://github.com/jstoup111/ai-conductor/pull/1334)).
- Merged specs whose plan uses an inline-code, linked, or annotated `**Stories:**` reference now resolve and dispatch instead of being silently dropped; `conduct-ts daemon status` lists blocked specs with reason and remedy; and a `## Migration` section that ends a PR body no longer parses as malformed release metadata. ([implementation PR #1337](https://github.com/jstoup111/ai-conductor/pull/1337)).
- The /stories skill now requires machine-parseable story IDs, preserving per-story validation, plan coverage, and coherence checks. ([implementation PR #1341](https://github.com/jstoup111/ai-conductor/pull/1341)).
- FINISH now re-enters immediately after a verified publication transition instead of spending step retry budget or escalation, bounded to 12 transitions per FINISH entry with a dedicated needs-human halt if publication still hasn't converged. ([implementation PR #1345](https://github.com/jstoup111/ai-conductor/pull/1345)).
- The live daemon E2E build step now dispatches a real, credentialed agent and the engine halts deterministically with a clear diagnostic when a step's slash command is unresolved by the provider's skill catalog, instead of the step silently reporting an artifactless success. ([implementation PR #1319](https://github.com/jstoup111/ai-conductor/pull/1319)).

## [0.99.20] - 2026-08-03

Two months of work between `v0.99.17` (2026-05-02) and the move to bot-owned release
pull requests. Entries are condensed by theme; per-change detail is in the linked
issues and in `git log v0.99.17..v0.99.20`.

### Added

- Multi-provider execution: a built-in `codex` provider alongside Claude, per-step provider routing (`llm_provider` as a scalar or an ordered array, with per-step overrides), and provider-aware model, effort and retry-escalation defaults ([#902](https://github.com/jstoup111/ai-conductor/issues/902), [#927](https://github.com/jstoup111/ai-conductor/issues/927), [#1089](https://github.com/jstoup111/ai-conductor/issues/1089)).
- tmux-supervised daemons with a full operator surface: `conduct-ts daemon start|stop|restart|connect|debug|status|logs`, pause/resume, park/unpark, a startup state dashboard, an install-freshness guard, and auto-restart when the running engine goes stale ([#215](https://github.com/jstoup111/ai-conductor/issues/215), [#307](https://github.com/jstoup111/ai-conductor/issues/307), [#486](https://github.com/jstoup111/ai-conductor/issues/486)).
- Rate-limit episode coordination: session- and usage-limit signals are classified as rate limiting beyond HTTP 429, provider reset times are parsed into absolute deadlines, and workers share one abortable, jittered wait instead of each backing off independently. New feature dispatch pauses while an episode is active and halted features are re-kicked when it clears.
- Retry-as-escalation: a step retry now escalates effort and then model tier rather than repeating an identical attempt, deep-step retry budgets drop from 5 to 3, and unavailable models fall back down a ladder instead of halting ([#186](https://github.com/jstoup111/ai-conductor/issues/186), [#188](https://github.com/jstoup111/ai-conductor/issues/188)).
- `wiring_check` — a gating step between `build_review` and `manual_test` that verifies every production surface the feature declares is actually reachable from a production entry point.
- `build_review` — a fresh-session judged gate at the build seam whose completeness rubric is the authoritative build-completion signal, with deterministic BUILD/REMEDIATE routing on FAIL ([#757](https://github.com/jstoup111/ai-conductor/issues/757), [#817](https://github.com/jstoup111/ai-conductor/issues/817), [#984](https://github.com/jstoup111/ai-conductor/issues/984)).
- Per-feature cost, token and wall-clock accounting: shipped records carry `## Cost` and `## Time` blocks and an `engine_version` stamp, `conduct-ts kpi` renders `cost=`/`time=`/`engine=` per feature, and an opt-in OpenTelemetry exporter publishes conductor run traces ([#537](https://github.com/jstoup111/ai-conductor/issues/537), [#1090](https://github.com/jstoup111/ai-conductor/issues/1090), [#1196](https://github.com/jstoup111/ai-conductor/issues/1196)).
- GitHub-issues intake for the engineer, with bidirectional write-back, issue-to-PR linkage and auto-close on merge, required priority/size/dependency labels at every capture surface, and a host-wide `conduct-ts brain start|stop|status` intake loop with desktop notifications ([#490](https://github.com/jstoup111/ai-conductor/issues/490), [#695](https://github.com/jstoup111/ai-conductor/issues/695)).
- Owner gating: a daemon builds only the merged specs it owns, resolving a machine-scoped operator identity and failing closed when no identity resolves, with write-back onto the gated spec's PR and originating issue ([#184](https://github.com/jstoup111/ai-conductor/issues/184)).
- Engineer worktree isolation and full DECIDE authoring — each idea is authored, landed and handed off inside its own worktree, running the complete explore → complexity → prd → architecture → stories → conflict-check → plan set ([#142](https://github.com/jstoup111/ai-conductor/issues/142)).
- Self-host guardrails for the harness building itself: a live-checkout boundary guard, a write-fence sandbox, a daemon-owned build-auth token separate from operator OAuth, a version-freeze approval gate, and a release gate that accepts a committed waiver ([#174](https://github.com/jstoup111/ai-conductor/issues/174), [#261](https://github.com/jstoup111/ai-conductor/issues/261), [#354](https://github.com/jstoup111/ai-conductor/issues/354), [#380](https://github.com/jstoup111/ai-conductor/issues/380)).
- SHIP automation: the implementation PR is opened as a draft at the start of SHIP, halt PRs are rehabilitated at finish, irrecoverable halts leave a labeled `needs-remediation` draft PR, a mergeable sweep auto-resolves conflicts, and `ci_watch` drives bounded automatic fixes for red ships ([#271](https://github.com/jstoup111/ai-conductor/issues/271), [#274](https://github.com/jstoup111/ai-conductor/issues/274), [#439](https://github.com/jstoup111/ai-conductor/issues/439), [#499](https://github.com/jstoup111/ai-conductor/issues/499)).
- Parallel SHIP validation: `manual_test`, `prd_audit` and `architecture_review_as_built` fan out as a concurrent group in auto-mode runs, bounded by a new `validation_concurrency` config key ([#469](https://github.com/jstoup111/ai-conductor/issues/469)).
- Autonomous gap remediation — a blocking `prd_audit`, as-built review or finish gate is routed through `/remediate` and repaired in place instead of halting for a human ([#115](https://github.com/jstoup111/ai-conductor/issues/115)).
- New skills: `verify-claims` (a cross-cutting correctness and assumption gate), `intake`, `daemon-triage`, `rebase` and `coherence-check`, plus an `operator_only` SKILL.md frontmatter field for skills invoked from outside a run.
- Mermaid rendering at the architecture approval gates, and `conduct render-diagrams --check` as an authoring-time syntax gate that fails on a broken diagram ([#810](https://github.com/jstoup111/ai-conductor/issues/810)).
- The `docs/` tree is published as a browsable GitHub Pages site with a landing page and site-wide navigation ([#1224](https://github.com/jstoup111/ai-conductor/issues/1224)).
- CI runs the harness integrity suite, the conductor build and vitest suite, `tsc --noEmit`, ESLint and ShellCheck on every pull request; documentation-only PRs skip the heavy jobs ([#789](https://github.com/jstoup111/ai-conductor/issues/789), [#802](https://github.com/jstoup111/ai-conductor/issues/802), [#1040](https://github.com/jstoup111/ai-conductor/issues/1040)).
- New `conduct-ts` surface: `kpi`, `finish-record`, `overlap-scan`, `build-auth-status`, `halt-issues sweep`, `evidence`, `memory setup`, an `--effort <level>` global override mirroring `--model`, and `--interactive` for conversational steps ([#1027](https://github.com/jstoup111/ai-conductor/issues/1027)).
- `bin/update` — a standalone self-update and channel CLI, invoked automatically as a one-shot subprocess at `conduct-ts` startup.
- Deterministic project-config scaffolding for new and existing repositories, auto-discovered skill linking into both `~/.claude/skills/` and `~/.agents/skills/`, and a `bin/install --allow-worktree-root` override for the worktree-root guard ([#1169](https://github.com/jstoup111/ai-conductor/issues/1169)).

### Changed

- The CLI is verb-first: the inline pipeline is `conduct-ts inline "<feature>"` and the daemon is `conduct-ts daemon …`, replacing the bare-argument and `--daemon` forms.
- Every step dispatch starts a fresh provider session, including within-step retries; Codex declares no session-resume capability, so each Codex dispatch is a cold start carrying its context through committed artifacts and the retry prompt ([#325](https://github.com/jstoup111/ai-conductor/issues/325), [#1110](https://github.com/jstoup111/ai-conductor/issues/1110)).
- Model selection is right-sized across the funnel and generated into HARNESS.md from `model-table-metadata.ts` rather than hand-edited, with front-of-funnel DECIDE steps and recovery steps defaulting to Fable ([#190](https://github.com/jstoup111/ai-conductor/issues/190)).
- `manual_test` is a gating step whose enforcement is locked, with an S-tier SKIP sentinel that satisfies downstream prerequisites; judged gate verdicts are re-validated against current code state rather than accepted on record ([#367](https://github.com/jstoup111/ai-conductor/issues/367), [#817](https://github.com/jstoup111/ai-conductor/issues/817)).
- Post-rebase gate re-verification is delta-aware: `build_review`, `wiring_check`, `manual_test`, `prd_audit` and `architecture_review_as_built` verdicts are preserved rather than re-run when the rebase did not affect them ([#655](https://github.com/jstoup111/ai-conductor/issues/655)).
- Daemon scheduling honors GitHub issue dependencies and priority labels, including a new `critical` band above `high`; the root checkout fast-forwards on each idle poll and feature worktrees are cut from `origin/<default>`.
- Daemon output is timestamped, colorized and transition-only, attributes each completed dispatch to the provider and model that ran it, and keeps routine skip notices behind `daemon_verbose: true`.
- `.memory/` is a symlink to a shared canonical store rather than a tracked in-project directory; ADRs are named `adr-YYYY-MM-DD-<kebab-slug>.md` instead of sequentially numbered; run-specific SHIP artifacts moved from tracked `.docs/` to gitignored `.pipeline/`.
- Configuration resolution deep-merges project `.ai-conductor/config.yml` over `~/.ai-conductor/config.yml` at every entry point, so user-level values survive keys a project omits ([#1031](https://github.com/jstoup111/ai-conductor/issues/1031), [#1199](https://github.com/jstoup111/ai-conductor/issues/1199)).
- README reference material moved into `docs/`, leaving a landing page that points at the documentation tree.

### Fixed

- Daemon reliability across the run lifecycle: halts carry a machine-readable `needs-human`/`mechanical` class so the re-kick sweep cannot wipe one needing a human, a step-heartbeat watchdog detects stalls, a no-verdict backstop records where the run stopped, park markers anchor to the main repository root, park/unpark resolve that root from any cwd, restart uses a single-generation handoff, and clearing a `HALT` marker re-dispatches the feature immediately ([#302](https://github.com/jstoup111/ai-conductor/issues/302), [#353](https://github.com/jstoup111/ai-conductor/issues/353), [#374](https://github.com/jstoup111/ai-conductor/issues/374), [#400](https://github.com/jstoup111/ai-conductor/issues/400), [#486](https://github.com/jstoup111/ai-conductor/issues/486), [#1070](https://github.com/jstoup111/ai-conductor/issues/1070), [#1148](https://github.com/jstoup111/ai-conductor/issues/1148)).
- Build-completion accuracy: the gate resolves the plan scoped to the current feature when several are in flight, accepts the full task-id grammar, sources expected paths from each task's `**Files:**` line, writes `task-status.json` atomically, and recovers finished work after a worktree is removed and recreated ([#407](https://github.com/jstoup111/ai-conductor/issues/407), [#417](https://github.com/jstoup111/ai-conductor/issues/417), [#424](https://github.com/jstoup111/ai-conductor/issues/424), [#425](https://github.com/jstoup111/ai-conductor/issues/425), [#497](https://github.com/jstoup111/ai-conductor/issues/497), [#1088](https://github.com/jstoup111/ai-conductor/issues/1088), [#1102](https://github.com/jstoup111/ai-conductor/issues/1102)).
- Rebase handling: conflicts route through a bounded, gated `/rebase` resolution loop, the rebase step uses `--autostash` so a dirty tree no longer mis-parks as a conflict, protected-artifact seals rebaseline safely when the base branch changes another feature's DECIDE artifact, and engine-owned rebases translate sha-anchored evidence citations instead of orphaning them ([#300](https://github.com/jstoup111/ai-conductor/issues/300), [#976](https://github.com/jstoup111/ai-conductor/issues/976), [#1121](https://github.com/jstoup111/ai-conductor/issues/1121)).
- Self-host builds no longer halt on the harness's own bookkeeping: the live-boundary guard skips `.git/`, `.daemon/`, `.pipeline/`, `node_modules` caches and provider-state caches, tolerates concurrent operator edits to tracked files, and names the differing paths when it does halt ([#985](https://github.com/jstoup111/ai-conductor/issues/985), [#1115](https://github.com/jstoup111/ai-conductor/issues/1115), [#1158](https://github.com/jstoup111/ai-conductor/issues/1158)).
- SHIP correctness: a shipped marker requires verified PR evidence, ship-readiness fails while the recorded PR is still a draft, discovery dedups on a shipped record committed to the feature's own branch, parked-feature reconciliation completes cleanup for squash-merged features, and a feature's worktree is retained until its ship is recorded ([#337](https://github.com/jstoup111/ai-conductor/issues/337), [#439](https://github.com/jstoup111/ai-conductor/issues/439), [#1146](https://github.com/jstoup111/ai-conductor/issues/1146), [#1157](https://github.com/jstoup111/ai-conductor/issues/1157), [#1185](https://github.com/jstoup111/ai-conductor/issues/1185)).
- Test-suite hygiene: the suite no longer leaks real `cc-daemon-*` tmux sessions, temp directories, `.pipeline/` artifacts, engineer-signal writes or undrained child processes into the operator's environment, and is deterministic under forked workers ([#252](https://github.com/jstoup111/ai-conductor/issues/252), [#257](https://github.com/jstoup111/ai-conductor/issues/257), [#377](https://github.com/jstoup111/ai-conductor/issues/377), [#437](https://github.com/jstoup111/ai-conductor/issues/437), [#573](https://github.com/jstoup111/ai-conductor/issues/573), [#861](https://github.com/jstoup111/ai-conductor/issues/861)).
- `bin/install` never hard-fails on a missing optional dependency, refuses global-mutating modes from a worktree-rooted checkout, builds the `conduct-ts` bundle itself, discovers skills instead of using a hardcoded list, and exits non-zero on drift under `--check` ([#363](https://github.com/jstoup111/ai-conductor/issues/363)).
- CLI correctness: `--help` renders the full recursive command reference, `daemon logs --follow` actually tails and `--lines N` is parsed, `--from <step>` validates against the resolved step registry, unknown `bin/conduct` subcommands fail loudly instead of launching the pipeline, and label mutations survive GitHub's Projects-classic sunset ([#178](https://github.com/jstoup111/ai-conductor/issues/178), [#1027](https://github.com/jstoup111/ai-conductor/issues/1027)).

### Removed

- RTK ("Rust Token Killer") from the install path.
- Serena semantic-search integration from the install path, bootstrap MCP registration, `HARNESS.md` guidance and the gitignore skeleton ([#682](https://github.com/jstoup111/ai-conductor/issues/682), [#728](https://github.com/jstoup111/ai-conductor/issues/728), [#753](https://github.com/jstoup111/ai-conductor/issues/753)).
- The `--daemon` flag, replaced by the `conduct-ts daemon` subcommand, and the `--output` / `--step <step>` flags, neither of which ever affected run behavior ([#1013](https://github.com/jstoup111/ai-conductor/issues/1013)).
- The per-task evidence gate and the semantic attribution judge lane, including the `attribution_enforcement_cutover` and `attribution_judge_cutover` config keys — per-task commit attribution is telemetry only ([#773](https://github.com/jstoup111/ai-conductor/issues/773), [#1211](https://github.com/jstoup111/ai-conductor/issues/1211)).
- `check_harness_config` (the consumer CLAUDE.md to HARNESS.md auto-upgrade) from `bin/conduct`; detection is retained by the session-start context hook ([#226](https://github.com/jstoup111/ai-conductor/issues/226)).

## Migration

```bash migration
for f in .ai-conductor/config.yml ~/.ai-conductor/config.yml; do
  [ -f "$f" ] || continue
  if grep -Eq '^(attribution_enforcement_cutover|attribution_judge_cutover):' "$f"; then
    sed -i.bak -E '/^(attribution_enforcement_cutover|attribution_judge_cutover):/d' "$f"
    echo "Removed retired attribution cutover keys from $f (backup: $f.bak)."
  else
    echo "$f has no retired attribution cutover keys — nothing to do."
  fi
done
```

```bash migration
# Reconcile the installed harness catalogs; foreign links and files are preserved.
"${HARNESS_DIR:?HARNESS_DIR must be set by bin/migrate}/bin/install" --update

# Find shell scripts/aliases/CI configs in the current directory tree that still pass the
# removed --output or --step flags to conduct-ts, so they can be edited by hand (nothing here
# is auto-rewritten — these are external, not tracked in this repo).
grep -rEn '\bconduct-ts\b.*(--output\b|--step\b)' \
  --include='*.sh' --include='*.yml' --include='*.yaml' . 2>/dev/null \
  || echo "No conduct-ts invocations with --output/--step found."
```

```bash migration
# Install the user-scoped HARNESS.md links consumed by generated CLAUDE.md and AGENTS.md.
"${HARNESS_DIR:?HARNESS_DIR must be set by bin/migrate}/bin/install" --update
```

```bash migration
# Unregister the harness-registered user-scope Serena MCP server (no-op if absent)
if command -v claude >/dev/null 2>&1 && claude mcp get serena >/dev/null 2>&1; then
  claude mcp remove --scope user serena
  echo "Removed user-scope 'serena' MCP registration."
else
  echo "No user-scope 'serena' MCP registration found — nothing to do."
fi
echo "Optional manual cleanup (NOT run automatically):"
echo "  uv tool uninstall serena-agent   # if you don't use Serena elsewhere"
echo "  pkill -f 'serena start-mcp-server'   # stop stray servers from old sessions"
echo "  rm -rf <project>/.serena/            # per-project semantic-index caches"
```

```bash migration
# Re-run the harness installer's settings merge so the new docs-guard.sh
# PreToolUse hook (Edit|Write|NotebookEdit matcher) is added to
# ~/.claude/settings.json. Safe to re-run: bin/install's settings merge is
# idempotent (matches on hook command path, does not duplicate entries).
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
"${HARNESS_DIR:?HARNESS_DIR must be set by bin/migrate}/bin/install" --update
echo "docs-guard.sh is now wired as a PreToolUse hook in ~/.claude/settings.json."
echo "Daemon-provisioned worktrees pick this up automatically on next"
echo "worktree-prepare handles newly provisioned worktrees automatically."
echo "If a running daemon needs new provisioning behavior, restart it yourself after this update."
```

```bash migration
# To use the attribution cutover, add attribution_judge_cutover and optionally
# attribution_audit_sample_pct to .ai-conductor/config.yml. Restart a daemon
# or conductor yourself after editing if it needs to read the new configuration.
echo "Configure attribution_judge_cutover in .ai-conductor/config.yml when ready."
```

```bash migration
# Link the new intake skill into ~/.claude/skills.
"${HARNESS_DIR:?HARNESS_DIR must be set by bin/migrate}/bin/install"
```

```bash migration
# Only needed if your project config disables manual_test.
# Remove the `manual_test:` disabled block from .ai-conductor/config.yml, e.g.:
if [ -f .ai-conductor/config.yml ] && grep -qE 'manual_test:' .ai-conductor/config.yml; then
  echo "manual_test step config found in .ai-conductor/config.yml —"
  echo "if it sets 'disabled: true', delete that line (gating steps cannot be disabled)."
  grep -n -A2 'manual_test:' .ai-conductor/config.yml
else
  echo "No manual_test step config found — nothing to do."
fi
```

```bash migration
# Set up daemon build-token if not already present
BUILD_AUTH_TOKEN_PATH="${HOME}/.ai-conductor/build-auth"

# Only mint if the file doesn't exist (no clobber of operator's existing token)
if [ ! -f "$BUILD_AUTH_TOKEN_PATH" ]; then
  echo "Setting up daemon build-auth token…"
  claude setup-token
  chmod 600 "$BUILD_AUTH_TOKEN_PATH"
else
  echo "Build-auth token already present at $BUILD_AUTH_TOKEN_PATH — no action needed."
fi

# Then configure the path in your harness config (.ai-conductor/config.yml):
echo "Configure in your harness config:"
echo "  harness_self_host:"
echo "    build_auth:"
echo "      token_path: $BUILD_AUTH_TOKEN_PATH"
```

```bash migration
# Existing worktrees keep their current hooks until they are re-provisioned.
# If you run a daemon, use your normal operator procedure to restart it after
# this update so future worktrees pick up the new provisioning code.
echo "Existing worktrees retain their hooks until re-provisioned."
echo "Enforcement stays OFF until attribution_enforcement_cutover is set in .ai-conductor/config.yml."
```

```bash migration
# Daemon lifecycle remains operator-controlled. If this project has an old
# detached daemon, stop it with your normal operator procedure before adopting
# the tmux-hosted daemon management workflow.
echo "Review any running daemon and choose its lifecycle action yourself."
```

```bash migration
# Rebuild the conductor engine (dist is no longer shipped in git).
cd "${HARNESS_DIR:?}/src/conductor" \
  && npm install --no-audit --no-fund \
  && npm run build
```

```bash migration
# bin/conduct now rejects unknown commands instead of silently launching the
# SDLC pipeline, and forwards conduct-ts verbs to conduct-ts. Verify conduct-ts
# is installed so forwarding works:
if command -v conduct-ts >/dev/null 2>&1; then
  echo "conduct-ts found: bin/conduct verb forwarding will work."
else
  echo "WARNING: conduct-ts not on PATH — forwarded verbs will exit 127."
  echo "Re-run bin/install to build and link conduct-ts."
fi
# Reminder: bare single-word feature descriptions are now rejected — quote
# multi-word descriptions instead, e.g.:  conduct "add user auth"
```

```bash migration
rm -f .claude/hooks/claude/post-commit-pipeline-sync.sh
# Install the new fast-feedback derive hook in your project's .git/hooks:
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo '.')"
if [ -d "$PROJECT_ROOT/.git" ] && [ -f "${HARNESS_DIR:?}/hooks/claude/post-commit-derive-feedback.sh" ]; then
  cp "${HARNESS_DIR:?}/hooks/claude/post-commit-derive-feedback.sh" "$PROJECT_ROOT/.git/hooks/post-commit"
  chmod +x "$PROJECT_ROOT/.git/hooks/post-commit"
  echo "Installed fast-feedback post-commit hook"
fi
```

```bash migration
# Ensure the daemon state dir is gitignored (pidfile + daemon.log live here).
if [ -f .gitignore ]; then
  grep -qxF '.daemon/' .gitignore || printf '.daemon/\n' >> .gitignore
else
  printf '.daemon/\n' > .gitignore
fi
echo "ensured .daemon/ is in .gitignore"
```

```bash migration
# Migrate .memory/ to the canonical shared store under ~/.ai-conductor/memory/.
# No-op if .memory/ is already a symlink. Run from the project root.
_dir="$(pwd)"
_link="${_dir}/.memory"
if [ -L "${_link}" ]; then
  echo ".memory/ is already a symlink — no migration needed."
elif [ -d "${_link}" ]; then
  if command -v conduct-ts >/dev/null 2>&1; then
    conduct-ts memory setup "${_dir}"
  elif [ -x "${HARNESS_DIR:-}/bin/conduct-ts" ]; then
    "${HARNESS_DIR}/bin/conduct-ts" memory setup "${_dir}"
  else
    echo "conduct-ts not found — please run 'conduct-ts memory setup ${_dir}' after updating." >&2
    exit 1
  fi
  echo "Migration complete. .memory/ is now a symlink to the canonical store."
else
  echo ".memory/ does not exist — it will be created automatically on next 'conduct' run."
fi
```

```bash migration
# Opt in to the semantic attribution verification lane by adding the cutover
# key to .ai-conductor/config.yml. No-op / prints guidance if the file is
# missing or the key is already present.
CONFIG_FILE=".ai-conductor/config.yml"
if [ ! -f "$CONFIG_FILE" ]; then
  echo "No $CONFIG_FILE found — nothing to migrate. Create one and add" \
       "attribution_judge_cutover to opt in when ready."
elif grep -qF '# attribution_judge_cutover: "2026-07-11T08:30:00Z"' "$CONFIG_FILE" 2>/dev/null; then
  echo "$CONFIG_FILE already contains the attribution configuration template — no migration needed."
else
  cat <<'EOF' >> "$CONFIG_FILE"

# Semantic attribution judgment gate (opt-in; absent = disabled).
# Uncomment and set a past ISO-8601 instant to activate the judge lane for
# unresolved evidence-gate residue. Restart the daemon/conductor to apply.
# attribution_judge_cutover: "2026-07-11T08:30:00Z"
# attribution_audit_sample_pct: 10
EOF
  echo "Appended commented-out attribution_judge_cutover / attribution_audit_sample_pct" \
       "template to $CONFIG_FILE. Uncomment and set a cutover instant to opt in;" \
       "restart your daemon after editing if it needs to reload configuration."
fi
```

```bash migration
# Refresh an existing worktree's commit-msg hook to the post-#773 (advisory,
# non-rejecting) version. Safe to run repeatedly; writeGitHooks() always
# overwrites both hook scripts with the current generated content.
WORKTREE_ROOT="${1:-.}"
HOOKS_DIR="$WORKTREE_ROOT/.pipeline/git-hooks"
if [ ! -d "$WORKTREE_ROOT/.pipeline" ]; then
  echo "No .pipeline/ found at $WORKTREE_ROOT — not a prepared conductor worktree;" \
       "nothing to migrate."
elif [ -f "$HOOKS_DIR/commit-msg" ]; then
  rm -f "$HOOKS_DIR/commit-msg" "$HOOKS_DIR/prepare-commit-msg"
  echo "Removed stale hook scripts at $HOOKS_DIR. Re-run 'conduct' (or restart the" \
       "daemon build step) for this worktree to have worktree-prepare regenerate" \
       "them with the post-#773 advisory (non-rejecting) commit-msg hook."
else
  echo "No commit-msg hook found at $HOOKS_DIR — nothing to migrate; it will be" \
       "generated fresh (already advisory) the next time this worktree is prepared."
fi
```

## [0.99.17] - 2026-05-02

## [0.99.16] - 2026-05-02

## [0.99.15] - 2026-05-02

## [0.99.14] - 2026-05-01

## [0.99.13] - 2026-05-01

## [0.99.12] - 2026-04-30

## [0.99.11] - 2026-04-29

## [0.99.10] - 2026-04-28

## [0.99.9] - 2026-04-28

## [0.99.8] - 2026-04-28

## [0.99.7] - 2026-04-28

## [0.99.6] - 2026-04-28

## [0.99.5] - 2026-04-28

## [0.99.4] - 2026-04-28

## [Unversioned] — pre-0.99.4 development

### Fixed
- conduct-ts: `build_review` graded the diff against the **wrong feature's plan**
  when several plans are present in `.docs/plans/` (the norm in a daemon worktree,
  which carries the whole repo's plan history). `runBuildReview` resolved the plan
  with an unscoped `.docs/plans/*.md` `sort()[last]` guess — the exact #407
  anti-pattern the build step already avoids — so it graded against the
  alphabetically-last plan (e.g. `writing-system-tests-red-exit-gate`) while the
  build step built the correct feature (`build-progress-1-based-display`). The
  grader then FAILed the build on a spurious scope/completeness mismatch against an
  entirely unrelated plan. Fixed by resolving through the slug-scoped
  `resolveFeaturePlanPath` (the same resolver the build step uses), which fails
  closed on ambiguity rather than grading someone else's plan. Regression test
  (`test/engine/build-review-plan-resolution.test.ts`).

- conduct-ts: the `engineer` routing adapter (Phase 9.3) built its provider call
  as `provider.invoke({ prompt } as any)`, omitting the **required** `sessionId`
  and `resume` fields of `InvokeOptions`. The `as any` cast hid the type error;
  at runtime the real `ClaudeProvider` emitted `claude --session-id undefined`,
  which the CLI rejects with *"Invalid session ID. Must be a valid UUID."* —
  every idea failed to route and silently fell through to "No matching project
  found. Would you like to create one?" even with a seeded registry. Fixed by
  passing a fresh `uuidv4()` session with `resume: false` (routing is a
  single-shot, stateless classification) and removing the `as any` cast so the
  type checker enforces the contract. Regression test
  (`test/acceptance/engineer-routing-session.test.ts`) drives the real
  `runEngineerMode` entry point and asserts the adapter hands the provider a
  valid-UUID `sessionId` — the seam no existing test exercised because every
  routing fake ignored its argument (same class as retro H-1).

- conduct-ts: the engine-native `rebase` loop step (Phase 9.0) could run a
  destructive `git rebase origin/<default>` against the **real** conductor
  worktree whenever a test drove a `Conductor` whose `projectRoot` resolved to
  the conductor's own checkout (the default is `process.cwd()`). It was a silent
  no-op while the dev branch stayed current with `origin/main`, but became a
  branch-corrupting rebase once `origin/main` advanced. Root-fixed by gating the
  step on daemon mode: rebase-on-latest is a **daemon finish-time mechanism**, so
  `runRebaseStep` now performs a clean no-op (gate still satisfied, loop topology
  unchanged) in any non-daemon run — interactive `/conduct` and the entire test
  suite. Only the daemon invokes git; humans rebase manually in interactive mode.
  `rebase-loop` integration specs now construct the `Conductor` with `daemon:true`
  (they exercise the real rebase against an isolated throwaway repo); `full-flow`
  and `plugin-end-to-end` also pass an isolated `projectRoot` as defence-in-depth.

### Changed
- **BREAKING (conduct-ts):** renamed the supervisor from **brain** to **engineer**.
  The CLI subcommand is now `conduct-ts engineer` (was `conduct brain`); the
  cross-project memory store moved from `~/.ai-conductor/brain/` to
  `~/.ai-conductor/engineer/`, and its env override from `$AI_CONDUCTOR_BRAIN_DIR`
  to `$AI_CONDUCTOR_ENGINEER_DIR`. The signal type `BrainSignal` is now
  `EngineerSignal` and `BrainStoreReader` is now `EngineerStoreReader`. No data
  format changed — only names and paths. See Migration below.

### Migration

If a previous `conduct-ts` daemon run created a cross-project store under the old
`brain` name, move it to the new `engineer` location and update any env override
in your shell profile (`AI_CONDUCTOR_BRAIN_DIR` → `AI_CONDUCTOR_ENGINEER_DIR`).

```bash migration
# Move the cross-project store dir to its new name (no-op if absent or already moved)
if [ -d "$HOME/.ai-conductor/brain" ] && [ ! -e "$HOME/.ai-conductor/engineer" ]; then
  mv "$HOME/.ai-conductor/brain" "$HOME/.ai-conductor/engineer"
  echo "moved ~/.ai-conductor/brain -> ~/.ai-conductor/engineer"
fi
# If you set AI_CONDUCTOR_BRAIN_DIR anywhere, rename it to AI_CONDUCTOR_ENGINEER_DIR.
```

### Added
- conduct-ts: **agent-hosted `engineer` redesign** (Phase 9.3). The engineer is
  reworked from a Node TTY REPL that spawned `claude -p` and wrote stub/DRAFT
  stories into an **agent-hosted, in-chat, human-gated DECIDE loop**: the host
  agent drives routing and the real DECIDE skills directly — no spawned `claude`,
  no Node readline REPL, no stub stories. Per idea it routes against the project
  registry, **requires human confirmation** before any write (confirm / decline /
  `redirect <name>` / `create <path>` when nothing fits → scaffolds + registers a
  new repo via the 9.2 `create` path), selects prior lessons from the engineer
  store (FR-5 flywheel), runs the **real DECIDE seam** to author `Status: Accepted`
  stories + a plan dependency tree on a `spec/<slug>` branch (artifacts under
  `.docs/` only — never source), and opens a spec **PR** — it **never** builds
  (`buildsRun` stays 0) and **never** merges (no `gh pr merge`); a merged spec PR
  is the only idea→build handoff. Regression-guarded: authoring never emits the
  old `_Generated by engineer._` stub, never a DRAFT story, and never spawns
  `claude` to author; an unapproved DECIDE step throws and fabricates nothing.
  New seams this phase:
  - **Hexagonal intake port + `Envelope` contract** (`{id, source, sourceRef,
    text, hintRepo?, status, receivedAt}`; parse-don't-validate with field-named
    errors — empty/whitespace text is **rejected, not silently dropped**). The
    `claude-session` adapter ships now; `github-issues`/inbox/write-back are
    additive future adapters behind the same port. Intake **idempotency** keys
    strictly on `(source, sourceRef)`, never on text.
  - **Cross-repo isolation** — authoring writes pass through an `AuthoringGuard`
    (`assertWriteAllowed` rejects `..`, absolute-sibling, and prefix-collision
    paths with `PathEscapeError`); authoring repo A leaves sibling repo B
    byte-for-byte unchanged, and a stale/missing target path fails fast with
    `TargetPathMissingError` (never a cwd fallback). Multi-repo **fan-out** is
    independent — one repo's failure never corrupts another, and a deselected
    repo is left untouched.
  - **pidfile-lock daemon liveness** — `.daemon/daemon.pid` created with `O_EXCL`
    is the **one-per-repo mutex** (exactly one winner under concurrent boots);
    `process.kill(pid, 0)` liveness with stale-pid reclaim that **never
    permanently refuses** (a kill-9 leftover is reclaimed on the next boot).
    `ensureRunning` spawns a detached daemon iff none/stale, no-ops if alive, and
    never manages the lifecycle. The registry `daemonState` mirror is
    non-authoritative — the pidfile wins.
  - **`launchDaemonDetached` fix** — launches with `cwd: repoPath` (was passing
    `--project`), so the pidfile and worktree land under the target repo.
  Read-only `governorReport` (aggregate spend + kickback/halt/retry rates) and
  `computeFlywheelTrend` (improving / insufficient_data over engineer-planned
  features) remain library functions over the engineer store.
- **Two SHIP-phase compliance gates** wired into the conduct-ts gate-driven tail, between
  `manual_test` and `retro`:
  - **`/prd-audit`** (new skill + `prd-auditor` agent) — audits the shipped implementation
    against the approved PRD's functional requirements (`FR-N`). Per-FR verdict
    `ALIGNED | PARTIAL | DIVERGED | MISSING` with `file:line` evidence and a gap-class
    (`impl-gap` → kick back to BUILD; `intended-drift` → kick back to DECIDE to amend the PRD).
    Loops until every FR is ALIGNED or human-ACCEPTED, with a 3-cycle rework budget then operator
    escalation. Objective gate: blocks while any audit-table row is a non-ALIGNED, un-ACCEPTED FR.
    Report at `.docs/audits/YYYY-MM-DD-<feature>-prd-audit.md`. Runs on opus.
  - **`/architecture-review --as-built`** (new mode on the existing `architecture-review` skill) —
    final drift sweep of shipped code vs **APPROVED** ADRs. Verdict
    `APPROVED | APPROVED WITH DRIFT NOTES | BLOCKED`; `BLOCKED` (code violates an APPROVED ADR)
    halts until a human fixes the code or supersedes the ADR. Report at
    `.docs/decisions/architecture-review-as-built-YYYY-MM-DD-<feature>.md`. Runs on sonnet.
  - conduct-ts step registry gains `prd_audit` and `architecture_review_as_built` (both
    `enforcement: gating`, `loopGate: true`); they inherit the verdict/selector/kickback loop.
    HARNESS.md model table, conduct skill flow/assess/gate-enforcement/skip tables, README,
    and `src/conductor/README.md` updated to match.
- conduct-ts daemon: **structured retro signal + engineer memory store** (Phase 9.1).
  On daemon feature completion (`done`/`halted`) the runner emits a structured
  `EngineerSignal` + a narrative to a cross-project store at `~/.ai-conductor/engineer/`
  (override `$AI_CONDUCTOR_ENGINEER_DIR`, dir auto-created). `signals.jsonl` is
  append-only, one atomic (`O_APPEND`, concurrency-safe) JSON line per
  feature-run: `{schemaVersion, ts, project, feature, runId, outcome, kickbacks[],
  halts[], retryHotspots[], tokens{...}, durationByStep{}, narrativeRef?}` —
  assembled from the feature's `events.jsonl` (reusing `report-renderer`
  aggregation) + `FeatureOutcome`, with empty categories as `[]` and an optional
  `narrativeRef`. Narratives live in `narratives/<project>/<feature>-<runId>.md`,
  keyed by `runId` so re-runs never overwrite (`done` → full retro via the LLM
  provider; `halted` → short halt note, no LLM call). Per ADR-002 Option A the
  in-loop `retro` step is **skipped under the daemon** (the emission step owns the
  narrative, keeping repos free of `.docs/retros/` clutter); manual `/conduct`
  runs are unchanged. Emission is **best-effort** — any store error is logged and
  swallowed, so a learning-signal write can never break a ship. A types-only
  `EngineerStoreReader` interface is exported for the future engineer (Phase 9.3).
- conduct-ts: project registry + creation (Phase 9.2). A single-writer registry
  module (`src/conductor/src/engine/registry.ts`) owns
  `~/.ai-conductor/registry.json` (override via `$AI_CONDUCTOR_REGISTRY`): atomic
  temp+rename writes, realpath-canonicalized dedup, credential redaction of remote
  URLs, and status provenance (`created` is never downgraded to `registered`). Two
  non-interactive CLI subcommands consume it: `conduct register [path]` registers an
  existing git repo (name=basename, absolute path, redacted origin remote), and
  `conduct create <name> [--remote <url>]` scaffolds a fresh project (git init +
  skeleton CLAUDE.md referencing HARNESS.md + `.gitignore` with `.pipeline/`,
  `.daemon/`, `.worktrees/`; `--remote` is add-only, no push) with a no-clobber
  guard. `/bootstrap` now auto-registers the project via `conduct register .` after
  onboarding (idempotent).
- conduct-ts: the gate loop's topology is now **derived from the step registry**
  instead of hardcoded, so custom config steps participate (Phase 8). New
  declarative `StepDefinition` flags `loopGate` (in the gate-driven tail) and
  `kickbackTarget` (re-openable upstream gate) replace the hardcoded
  `LOOP_GATE_STEPS`/`KICKBACK_TARGETS`/`regionStart` — built-ins set them
  (build/manual_test/retro/finish = loopGate; stories/plan = kickbackTarget) so
  behavior is unchanged. A custom `.ai-conductor/config.yml` step **inherits its
  `after` target's loop membership** — one inserted among the loop steps
  (build…finish) joins the loop automatically; `gate: true|false` forces/opts out,
  and `kickback_target: true` marks it re-openable. The conductor derives the
  front/loop boundary from the first loop gate, so reordering and custom steps
  both flow through.
- conduct-ts daemon: `--continuous` mode — instead of draining the backlog once
  and exiting, the daemon idle-polls for newly-eligible features (the poll loop
  already existed; this wires it through). Gated by hard ceilings, all new flags:
  `--max-cost <tokens>` (global output-token ceiling), `--max-runtime <seconds>`
  (wall-clock), `--idle-poll <seconds>` (poll interval), `--max-idle-polls <n>`
  (stop after N empty polls). Ceilings stop *starting* new features; in-flight
  work always drains. `--continuous` with no ceiling logs an unbounded-run
  warning. Closes the Phase 7 "then enable continuous" deliverable. The
  wall-clock ceiling (`time_ceiling` stop reason) is new in `runDaemon`;
  `max_items` and `cost_ceiling` already existed.
- conduct-ts daemon: per-step loop progress is now printed to the console. The
  daemon previously wired a **no-op event renderer**, so it went silent between
  `[daemon] ▶ start <slug>` and `✓ shipped` while the whole gate loop ran live in
  the worktree — "started, no meaningful logs." `daemon-cli.ts` now renders
  step boundaries, failures/retries, unsatisfied gate verdicts, kickbacks, halts,
  convergence, and rate limits (prefixed `· `). Events carry no feature slug, so
  with `--concurrency > 1` lines from different workers interleave. Found in
  Phase 7 daemon validation.
- conduct-ts: **rebase-on-latest before finish** (Phase 9.0). A new engine-native
  `rebase` loopGate step (no Claude dispatch, like `complexity`) runs after
  `build`+`manual_test` and before `finish`, rebasing the worktree branch onto the
  **discovered** origin default branch (`git symbolic-ref refs/remotes/origin/HEAD`,
  fetched; falls back to the local base when there's no origin or the fetch fails —
  no hardcoded `main`). Its gate verdict is *satisfied ⇔ the branch is already
  current with the base*, so a no-op rebase goes straight to the PR and re-entry
  after a kickback never re-invalidates. A **clean rebase that changed code/test
  paths** invalidates `build` (+`manual_test` if it ran) via the existing
  kickback machinery (`{from:'rebase', to:'build'}`) so the PR is never built on a
  stale base; a **docs-only / CHANGELOG-only** change does **not** invalidate. A
  rebase conflict confined to `CHANGELOG.md`'s `[Unreleased]` block is
  **auto-resolved** (take the base's merged entries, re-append this feature's lines
  exactly once); any other or mixed conflict writes `.pipeline/HALT` (conflicted
  files + resume steps), leaves the rebase **paused** (no `--abort`), and opens no
  PR. Outcomes emit typed events (`rebase_noop` / `rebase_changed` /
  `rebase_changelog_resolved` / `rebase_conflict_halt`).

### Changed
- conduct-ts daemon: backlog **eligibility is now gated on approval + well-formedness**.
  `discoverBacklog` only picks up a feature when its stories are **approved**
  (`Status: Accepted`, not DRAFT) and its plan declares a **task dependency tree**
  (`## Task Dependency Graph` or per-task `**Dependencies:**` lines). The daemon
  pre-seeds the front half (stories/plan = done) and never re-runs their gates, so
  eligibility is the only place specs are vetted before autonomous build — previously
  any feature with stories+plan *files* present was picked up, DRAFT or not, dependency
  tree or not. Ineligible features are skipped with a logged reason (`[daemon] skip …`).
- harness: new **"Docs track features"** convention (HARNESS.md + this repo's CLAUDE.md):
  every change that adds/alters user-facing behavior must update the `README` and affected
  docs in the same PR; the `finish` step verifies docs reflect what shipped.
- conduct-ts: the `plan` gate now also requires a **task dependency tree** (in addition to
  per-path-type story coverage), so the dependency graph the `build`/pipeline skill
  consumes for topological ordering is actually enforced, not just requested.
- conduct-ts: DECIDE order now runs **architecture before plan** — `stories →
  conflict_check → architecture_diagram → architecture_review → plan →
  acceptance_specs`. Architecture (system-level HOW) grounds the technical plan
  (task-level HOW) instead of being reviewed after it. Prerequisites reordered in
  `engine/steps.ts`; skipped steps still satisfy gates so Small tier is unaffected;
  custom `.ai-conductor/config.yml` steps still resolve (inserted by name). Legacy
  bash `bin/conduct` keeps the prior plan→architecture order (its architecture-review
  gates on the plan); `conduct-ts` is canonical.
- DECIDE phase is now PRD-driven. `templates/design-doc.md.template` is a PRD with
  **enumerated functional requirements (`FR-N`)** plus goals/non-goals, users, NFRs,
  acceptance criteria, and dependencies. `skills/brainstorm` requires those sections;
  `skills/stories` extracts **one or more granular stories per `FR-N`** (behavioral WHAT,
  happy + negative) tagged with their `FR-N` for traceability; `skills/plan` is framed as
  the **technical implementation plan (HOW)** build ships from — it opens with a Technical
  Approach section and keeps the required Design-doc link. Traceability runs PRD `FR-N` →
  story → plan task.

### Fixed
- `block-destructive-git` hook: **ad-hoc `git rebase` onto a base is now blocked**.
  A mid-build rebase onto an advanced `main` rewrites history under active work and
  triggers surprise conflicts (it disrupted two feature branches during Phase 9).
  The only sanctioned rebase is the daemon's finish-time rebase-on-latest (runs via
  execa, not this hook, with conflict→HALT + CHANGELOG auto-resolve); deliberate
  branch updates require asking the user. Resolving an in-progress rebase
  (`--continue`/`--abort`/`--skip`/`--edit-todo`) is still allowed.
- `block-destructive-git` hook: `git branch -D` is no longer hard-blocked for
  **merged** branches. Squash/rebase-merged branches (GitHub's default) aren't
  ancestors of the default branch, so plain `git branch -d` refuses them and the
  operator was forced to use `-D` — which the hook blocked outright, stranding
  routine post-merge cleanup. The hook now allows `-D` only when every named
  branch is provably merged (an ancestor of the default branch, or has a merged
  PR via `gh`); genuinely unmerged force-deletes are still blocked.
- `block-destructive-git` hook: detection now ignores blocked patterns that
  appear **inside quoted arguments** (commit messages, `echo`, comments). The
  hook previously grepped the raw command, so a command that merely *mentioned* a
  pattern (e.g. `git commit -m "...git reset --hard..."`) was wrongly blocked. It
  now matches against the command with quoted spans stripped, so only the real,
  unquoted operation triggers a block. (Trade-off: a destructive command fully
  wrapped in quotes, e.g. `bash -c "git reset --hard"`, is not caught.)
- conduct-ts: test suites no longer fail to load on the dev machine's default
  Node. The conductor needs Node ≥20.5 (execa imports `addAbortListener`), but
  only `src/conductor/.tool-versions` pinned Node 20 — running `npm test` from
  the repo root used the machine default (e.g. 19.6), so 8 suites failed with
  `node:events does not provide an export named 'addAbortListener'`. Added a root
  `.tool-versions` (`nodejs 20.19.2`) so asdf selects Node 20 repo-wide, plus an
  `engines: { node: ">=20.5.0" }` field documenting/enforcing the requirement for
  non-asdf users. All 70 suites / 979 tests now run. `bin/install` also surfaces
  the requirement: when the `conduct-ts` bundle is missing it checks the active
  Node and, if < 20.5, warns with actionable guidance (`asdf install nodejs
  20.19.2`) instead of letting the user hit a cryptic asdf error on `npm run build`.
- conduct-ts: **worktree isolation** — the spawned `claude` subprocess now runs
  in the step runner's `projectDir` (`cwd`), not the parent process's working
  directory. `ClaudeProvider` invoked `execa('claude', …)` with **no `cwd`**, so
  in daemon mode every step ran in the daemon's main checkout instead of the
  feature's worktree: the build agent committed the whole implementation to
  `main` (6 commits) while the `feat/daemon-<slug>` branch stayed empty, and the
  worktree's `.pipeline` desynced (surfacing as a `session-created` ENOENT). The
  `cwd` now threads `InvokeOptions.cwd` → `execa` and `DefaultStepRunner` passes
  `projectDir` on all four provider calls. Found in Phase 7 daemon validation;
  overlaps the intent of PR #72 (per-feature isolation).
- conduct-ts daemon: an auto-mode hard failure now writes a `.pipeline/HALT`
  marker instead of returning silently. Previously a gating/structural step
  failing in `--auto` did `writeState; return` with no marker, so the daemon's
  `readOutcome` saw neither `DONE` nor `HALT` and reported the opaque
  `error — loop ended without DONE or HALT marker`. The conductor now writes
  `HALT` (with the failed step in the reason) and emits `loop_halt`, so the
  daemon classifies it as `halted` — worktree kept, NOT marked processed,
  retryable after a human looks. Found in Phase 7 daemon validation.
- conduct-ts daemon: re-running the daemon after a kept (halted/errored)
  worktree no longer aborts with `fatal: A branch named 'feat/daemon-<slug>'
  already exists`. `createWorktree` now reuses an existing registered worktree
  for the slug (resume-after-human-fix), attaches to an existing branch when the
  worktree was removed but the branch lingered, and only creates a fresh
  branch+worktree when neither exists. Found in Phase 7 daemon validation.
- conduct-ts: the `plan` coverage gate no longer false-fails (and kicks the loop
  back to `plan` forever) on the real generator's output format. Stories use
  `## Story N:` headings (id `N`) and plan tasks reference `**Story:** Story 1
  (FR-1, FR-2)` with the path type on a separate `**Type:** happy-path` line. The
  old matcher captured the literal word "Story" as the id and read happy/negative
  only from the parens (which hold `FR-N` refs), so coverage never matched —
  verdict `plan does not cover: 1 happy, 1 negative, …`. The matcher is now
  task-block-aware: it strips an optional `Story `/`Epic ` prefix word from the
  id and reads the path type from the `**Type:**` line, the Story parens, or a
  path keyword — while still accepting the prior `**Story:** 3.2-1 (happy path)`
  and `## Coverage Check` table formats. Found in Phase 7 validation.
- conduct-ts: the `finish` step no longer stalls the loop in `--auto`. The finish
  skill normally asks the user to pick Merge/PR/Keep/Discard; in unattended mode
  print-mode Claude emitted prose and exited without writing
  `.pipeline/finish-choice`, leaving the gate permanently unsatisfied. In auto
  mode the step now gets an explicit directive to decide deterministically and
  act: open a PR (never merge) and record `pr_url` when a git remote + `gh` are
  available, else `keep` the branch — ending by writing the chosen value to
  `.pipeline/finish-choice`. `skills/finish/SKILL.md` documents the same fallback.
  Found in Phase 7 validation.
- conduct-ts: the `acceptance_specs` completion check no longer false-fails on
  non-Rails projects. Its artifact globs were Rails-only (`spec/acceptance/**/*`,
  `test/acceptance/**/*`), so a Node project — whose `writing-system-tests` skill
  correctly wrote `app.test.js` at the root — failed the gate with "no files
  matching …". Broadened to common conventions (`test/**/*`, `tests/**/*`,
  `__tests__/**/*`, root-level `*.test.{js,ts}` / `*.spec.{js,ts}`, plus Rails
  `spec/requests` and `spec/system`), scoped to avoid recursing `node_modules`.
  Found in Phase 7 validation.
- conduct-ts: `--auto` no longer drops into an interactive session. Two paths
  opened a REPL / recovery menu without checking the mode: the build-stall
  circuit breaker (`runInteractive`) and the post-retry recovery menu
  (`onRecovery`, which the CLI wires even in auto). Auto mode is unattended, so
  on an exhausted-retry failure it now: auto-skips **advisory** steps (so an
  advisory failure can't block the run) and stops on **gating/structural**
  failures (e.g. plan, build) for a human to inspect — never prompting. Found in
  Phase 7 validation.
- conduct-ts: collaborative steps (`brainstorm`, `stories`, `plan`, `manual_test`,
  `finish`) now skip permissions in `--auto` mode. They were dispatched with
  `dangerouslySkipPermissions: false` even when unattended, so the spawned
  `claude` launched in the user's default permission mode — if that's **plan
  mode, every write is blocked**, so brainstorm could never save its
  `.docs/specs/` PRD and the step looped (`no files matching .docs/specs/*.md`)
  with no human and no ExitPlanMode tool to recover. In auto mode there is no one
  to approve permissions, so these steps now skip them like autonomous steps do;
  interactive REPL mode (non-auto) still prompts. Found in Phase 7 validation.
- conduct-ts: the `worktree` step is now engine-managed (deterministic
  `WorktreeManager.create` → `git worktree add -b`) instead of dispatching
  `/conduct worktree` to Claude. The skill path let Claude run a broad
  self-directed orchestration — skipping `brainstorm` ("Feature defined in
  spec"), so **no PRD was persisted**, and botching git so the main repo ended
  up on the feature branch with an empty detached worktree. The engine now
  creates the worktree (main untouched) and drives `brainstorm` etc. normally,
  so the PRD chain holds. Worktree-creation failure degrades gracefully (warn +
  continue in-place) rather than blocking the run. Found in Phase 7 validation.
- conduct-ts: interactive steps (`brainstorm`, `stories`, `plan`, `manual_test`,
  `finish`) no longer hang silently in `--auto`. `invokeInteractive` ran every
  step with `stdio: 'inherit'`, but in print mode (`claude -p`, used for all
  interactive steps under `--auto`) an inherited TTY stdin never reaches EOF, so
  the process blocked forever with no error. Print mode now uses
  `['ignore', 'inherit', 'inherit']` (stdin ignored, output still live), matching
  the autonomous path; REPL mode (`interactive: true`) still inherits all stdio.
- conduct-ts: a "session in use" lock now self-recovers. `ClaudeProvider` detects
  the session-id lock message (`already in use` / `session … in use by another
  process`) and routes it through the existing stale-session path — the conductor
  resets to a fresh session id and retries without burning the retry budget,
  instead of failing the step. The `session_reset` event reason is now generic
  ("session unavailable (expired or in use)").
- conduct-ts: fixed `Fatal: __dirname is not defined` crash on startup. `src/conductor/src/index.ts` referenced the CommonJS-only `__dirname` global inside `readHarnessVersion()`, but the bundle is ESM (`tsup` `format: ['esm']`, `shims: false`), so the binary aborted before the CLI could parse args. Derived `__dirname` from `import.meta.url` using the same pattern already in `src/conductor/src/engine/plugin-manifest.ts`.
- conduct-ts: SHIP-phase steps no longer silently mark a feature complete when pipeline exits mid-implementation. The conductor now stamps each invocation with `state.session_started_at` and the `manual_test`, `retro`, and `finish` completion predicates require fresh, feature-scoped evidence:
  - `manual_test` requires `.docs/manual-test-results.md` with no `| FAIL` rows AND mtime >= `session_started_at` (previously had no completion gate at all — any clean REPL exit marked it `done`)
  - `retro` requires a `.docs/retros/*-<slug>.md` file matching the current `feature_desc` slug AND fresh mtime; falls back to "any retro fresh in this session" when slug is unavailable (previously matched any file under `.docs/retros/`, including stale prior-feature retros)
  - `finish` requires a fresh `.pipeline/finish-choice` marker (mtime >= `session_started_at`); for `choice="pr"`, additionally requires `state.pr_url` to be set; the conductor sweeps stale `.pipeline/finish-choice` from prior sessions on `Conductor.run()` entry (previously the marker could survive across sessions and `state.pr_url` alone could pass the gate)
- conduct-ts: `build` completion predicate now fails when `.pipeline/halt-user-input-required` is present, even with all-complete `task-status.json`. A halt marker that survives to gate-check time means a true halt that bypassed the conductor's stall handler — the predicate now treats it as a build failure so the cascade through SHIP-phase steps doesn't fire.
- conduct-ts: when auto-resume detects an "already complete" feature, the conductor now re-verifies the SHIP-phase predicates and offers a recovery prompt (roll back `feature_status` and resume at the first failing step, or keep state as-is). Self-heals worktrees that hit the prior false-completion bug.
- skills/pipeline/SKILL.md: documents the "User-requested exit during a run" contract — when the user asks to "exit to harness", "stop and continue later", etc., the skill MUST write `.pipeline/halt-user-input-required` before exiting and MUST NOT mark unfinished tasks as `completed`/`skipped`. Without the marker the conductor reads `task-status.json`, sees nothing in flight, and concludes the build step is done — silently cascading through SHIP to mark the feature complete while the user's actual blocker is still open.
- skills/manual-test/SKILL.md: instructs the skill to save results to `.docs/manual-test-results.md` (in addition to displaying in chat) so the conductor's completion gate can verify them. The previous "do NOT write to a file" wording contradicted what the bash conductor was already injecting at dispatch time.
- CHANGELOG.md: fixed unclosed backtick in the preamble that the release workflow had to step around.
- conduct-ts: `src/conductor/src/index.ts` no longer runs the CLI `main()` as an import side-effect. The unguarded top-level `main().catch(... process.exit(1))` fired whenever a test imported the module (e.g. `deriveMode`), so `process.exit(1)` surfaced as an unhandled rejection that flakily failed the parallel `vitest` run and forced a non-zero exit. Guarded with the standard ESM entry-point check (`import.meta.url === pathToFileURL(process.argv[1]).href`). The full suite now exits 0 deterministically.
- conduct-ts test: the `saves state on SIGINT` test in `test/engine/conductor.test.ts` now stubs `process.exit`; it previously invoked the real SIGINT handler's `process.exit(130)`, leaking an unhandled rejection into the run.

### Added
- conduct-ts: gate-loop daemon foundation (Phase 6) — `engine/daemon.ts`
  (`runDaemon`) is the parallel worker-pool orchestration core: pulls features
  from a backlog, runs up to N concurrently (each isolated behind the injected
  `runFeature`), enforces hard ceilings (max items, global token cost), honors
  `once` vs idle-poll, and isolates a thrown feature as an `error` outcome so the
  pool survives. `engine/daemon-backlog.ts` (`discoverBacklog`) finds
  daemon-eligible features — those with both stories AND plan present (the daemon
  consumes specs, never authors them) — skipping already-processed slugs.
  `engine/daemon-runner.ts` (`makeRunFeature`) is the per-feature orchestration
  (done → mark+remove worktree+PR; halted/error → keep worktree for the human; a
  thrown primitive is caught). `engine/daemon-deps.ts` provides the concrete
  git/fs primitives (worktree add/remove, spec materialization with commit,
  `.pipeline/DONE`/`HALT` outcome read, processed markers). New `--daemon`
  (+`--concurrency`, `--max-items`) CLI flag and `daemon-cli.ts` assemble a
  per-worktree Conductor (`verifyArtifacts`+`freshContextPerStep`, `fromStep:
  acceptance_specs`) and run the pool. 22 tests cover the orchestration,
  ceilings, isolation, eligibility, and outcome-reading; the live git/provider/PR
  path is exercised by end-to-end validation (Phase 7).
- conduct-ts: gate-loop observability — new `ConductorEvent` types `gate_verdict`
  (step, satisfied, reason), `kickback` (from, to, evidence, count), `loop_halt`
  (reason), and `loop_converged`, emitted from the conductor's gate-driven tail.
  `TerminalRenderer` surfaces unsatisfied verdicts, kickbacks (with reason + count),
  HALTs, and convergence; the json-stdout subscriber serializes them as-is. (The
  kickback now emits a dedicated `kickback` event instead of reusing
  `navigation_back`, which stays reserved for user-driven back-navigation.)
- conduct-ts: hybrid session model — new `freshContextPerStep` option. When on,
  the conductor resets the LLM session before each new step in the looped region
  (`build`…`finish`), so each runs on fresh context (Ralph-style — context never
  bloats across the SHIP phase) while a step's own retries still resume.
  **Historical intermediate behavior:** the front half remained persistent and
  the option defaulted off. This was later superseded by
  ai-conductor#325 / PR #365, which makes fresh-per-step unconditional across
  all phases and retains resume only within a step's retries.
- conduct-ts: the conductor now drives the **resolved step registry**
  (`buildStepRegistry(config)`) instead of the static `ALL_STEPS`, so **custom
  steps** defined in `.ai-conductor/config.yml` (via `after:` + `skill:`) are
  dispatched, indexed, and participate in the gate loop. All index math, the
  selector, `navigateBack`/`getNavigableSteps`, and `findResumeIndex` key off the
  resolved list; loop-body checks use the registry def directly (so custom steps,
  absent from the static map, no longer throw `Unknown step`). `checkGate` accepts
  a `StepDefinition`. (Previously `buildStepRegistry` was built and tested but
  never wired into the runtime — custom steps never ran.)
- conduct-ts: gate-driven loop — selector + tail conversion. New
  `src/conductor/src/engine/selector.ts` (`selectNextGate` — earliest unsatisfied
  gate, config-agnostic). `conductor.ts` now drives the back half (`build`→`finish`)
  via the selector instead of a linear `i++`: after `build` engages, the next step
  is the earliest unsatisfied gate; a step that re-opens an upstream gate (kickback
  verdict `{satisfied:false, kickback.from}`) routes the loop back to plan/stories
  via `navigateBack` + downstream-stale cascade. Convergence writes `.pipeline/DONE`;
  an anti-ping-pong cap and a per-gate selection cap write `.pipeline/HALT`. The tail
  engages only with `verifyArtifacts` on — otherwise the conductor stays fully linear
  (unchanged). The front half (`worktree`…`acceptance_specs`) is untouched.
- conduct-ts: gate-driven loop foundation (verdict layer) — new `src/conductor/src/engine/gate-verdicts.ts` with `computeAndWriteVerdict`/`writeVerdict`/`readVerdict`/`readAllVerdicts`/`checkGateCompletion`, persisting per-feature gate verdicts (`{satisfied, reason, checkedAt, kickback?}`) to `.pipeline/gates/<step>.json`. Adds `GATE_ONLY_PREDICATES` in `engine/artifacts.ts` with machine-checkable `stories` (happy + negative path, no DRAFT) and `plan` (per-path-type story coverage) predicates — kept separate from `CUSTOM_COMPLETION_PREDICATES` so the existing linear conductor is unchanged. Blueprint in `.docs/decisions/gate-audit-2026-06-23.md`. (Selector + loop conversion land in a later change.)
- conduct-ts: new `--diagnose` CLI flag — non-mutating diagnostic that loads state for the named (or current) feature, re-verifies the SHIP-phase predicates, and prints any inconsistencies. Exits 0 when state is consistent, 1 when state is marked complete but evidence is missing.
- conduct-ts: new `feature_complete` event payload fields (`featureDesc`, `sessionStartedAt`) and a multi-line bg-green completion banner in `TerminalRenderer` so a finished run is impossible to read as "stopped processing without error" — the previous single-line green render could be missed in a long pipeline run.
- conduct-ts: new `state.session_started_at?: number` (epoch ms) — set on every `Conductor.run()` entry, used by SHIP-phase freshness checks. Purely additive; old state files deserialize fine.
- conduct-ts: new `complete-verifier.ts` module with `verifyCompleteState(worktreePath)` and `formatGapReport(...)` helpers, shared between auto-resume's recovery path and the `--diagnose` flag.
- `UIRenderer` interface (`handle(event): Promise<void>` + `stop()`) in `src/conductor/src/ui/types.ts` — new plugin contract for UI renderers
- `TerminalRenderer` class in `src/conductor/src/ui/terminal-renderer.ts` implementing `UIRenderer` (replaces the `createRenderer` factory function; backward-compat factory retained in `create-renderer.ts`)
- `dispatchRenderers(renderers, event)` in `src/conductor/src/ui/dispatch.ts` — fan-out via `Promise.allSettled`, renderer degradation (one throw doesn't kill others), re-emits `renderer_error` event to survivors
- `renderer_error` event type in `src/conductor/src/types/events.ts` — carries `rendererName` and `error` string
- `RecordingRenderer` test double in `test/ui/recording-renderer.ts` — records events, supports `delayMs` and `throwError` injection
- `registerBuiltins()` now accepts optional `TerminalRendererOptions` and registers `TerminalRenderer` as `ui_renderer:terminal_renderer` alongside the existing `TerminalSubscriber`
- New test files: `test/ui/terminal-renderer.test.ts` (TerminalRenderer class), `test/ui/dispatch.test.ts` (dispatch + degradation + slow-renderer + dup-renderer scenarios)
- `RecorderProvider` reference LLM provider plugin at `plugins/recorder-provider/` — logs every `invoke()` and `invokeInteractive()` call as a JSONL line to a configurable path, returns a canned response, creates parent directories on first write, and throws `RecorderProviderError` on write failure
- Unit tests for RecorderProvider (11 tests) covering JSONL format, canned response, parent-dir creation, error handling, concurrent writes, and invokeInteractive
- Integration tests for RecorderProvider flow (7 tests) covering happy path, misspelled kind rejection, missing plugin dir, version-incompatible manifest, and empty prompt
- RecorderProvider installs through the plugin loader with zero edits to `src/conductor/src/index.ts`
- `when?: string` field on `StepConfig` — conditional step skip evaluated before dispatch
- `parallel?: ParallelBranch[]` field on `StepConfig` — concurrent step groups via `Promise.all`
- `ParallelBranch` type: `{ name, skill?, model?, effort?, advisory? }` — discriminated from skill steps (mutual exclusion)
- `evaluateWhen(expression, state)` in `src/engine/when-expression.ts` — five grammar forms: `tier == L`, `tier in [M, L]`, `phase == BUILD`, `${key} == value`, `A && B`
- `validateWhenSyntax(expression)` — config-load-time syntax check, returns error string or null
- Four new `ConductorEvent` variants: `when_skip`, `parallel_started`, `parallel_completed`, `parallel_failure`
- Conductor evaluates `when:` before dispatching each step; emits `when_skip` when false
- Conductor fans out `parallel:` branches via `Promise.all`; writes synthetic state keys `<group>__<branch>` to `conduct-state.json`
- Gating branch failure (`advisory: false`, the default) → group fails → downstream blocked
- Advisory branch failure (`advisory: true`) → logged via `parallel_failure` event, group continues to success
- `when:` on a parallel group → all synthetic keys set to `"skipped"` when expression is false
- Terminal renderer handles `when_skip`, `parallel_started`, `parallel_completed`, `parallel_failure` events in `create-renderer.ts`
- Config validator (`engine/config.ts`) validates `when:` syntax and `parallel:` structure at config-load time
- 59 new tests across `when-expression.test.ts`, `when-parallel.test.ts`, `when-parallel-renderer.test.ts`
- Feature 3.2: json-stdout-subscriber plugin — emits ConductorEvents as newline-delimited JSON to stdout; selectable via `ui_renderer: json-stdout` in config. Each line includes all original event fields plus a `ts` ISO timestamp. handle() before start() is a no-op (no crash). Plugin discovered automatically by the plugin loader — no changes to `src/conductor/src/index.ts` required.
- Feature 4.1: EventPersister — every ConductorEvent persisted with timestamp to `.pipeline/events.jsonl` (newline-delimited JSON, replayable). Subscribes to event bus as a listener; zero changes to emission sites in `conductor.ts` or `step-runners.ts`.
- Feature 4.1: `conduct --report` subcommand — reads `.pipeline/events.jsonl` and renders step durations (sorted descending), retry hotspots (with failed-step annotation), and token spend tables. Read-only; does not start a Claude session.
- Feature 4.1: Optional `tokenUsage` field on `InvokeResult` — backwards-compatible; `ClaudeProvider` parses from Claude CLI `stream-json` output; `RecorderProvider` synthesizes deterministic counts (`{ input: 10, output: 5 }`) for stable test fixtures. Report gracefully omits token rows when field is absent.
- Plugin manifest schema (`plugin.yml`) with `kind`, `name`, `entrypoint`, `harness_version`, `capabilities?` fields
- `PluginKind` enum: `llm_provider | ui_renderer | step | hook | visualizer`
- Five typed error classes: `PluginManifestError`, `PluginVersionError`, `PluginLoadError`, `PluginNotFoundError`, `PluginRegistryError`
- `validateManifest()` with required-field, kind-enum, name-format (`/^[a-z0-9-]+$/`), and semver compatibility checks
- `loadManifestFromFile()` wrapping YAML parse and I/O errors with file path context
- `PluginRegistry` class: `register<K>()`, `get<T>()`, `list()`, `markInitialized()` with initialization guard
- `discoverPlugins()`: scans global (`~/.ai-conductor/plugins/`) and project-local (`.ai-conductor/plugins/`) directories; project-local shadows global with debug log
- `registerBuiltins()`: `ClaudeProvider` → `llm_provider:claude`, `TerminalSubscriber` → `ui_renderer:terminal`
- `src/index.ts` refactored: no longer hardcodes `new ClaudeProvider()` or `new TerminalSubscriber()` — both retrieved from registry
- Integration tests: default-fallback (blank config → claude provider), EchoProvider E2E (external plugin discovery and invocation), version-mismatch and missing-entrypoint negative paths

### Migration

New optional `when:` and `parallel:` stanzas in `.ai-conductor/config.yml` (Feature 3.1):

```bash
# Conditionally skip a step — skip 'brainstorm' on small features:
cat >> .ai-conductor/config.yml << 'EOF'
steps:
  brainstorm:
    when: "tier in [M, L]"
EOF

# Skip a step based on bootstrap mode:
cat >> .ai-conductor/config.yml << 'EOF'
steps:
  assess:
    when: "${bootstrap_mode} == fresh"
EOF

# Run two skills concurrently in a parallel group:
cat >> .ai-conductor/config.yml << 'EOF'
steps:
  build:
    parallel:
      - name: frontend
        skill: skills/build-frontend/SKILL.md
      - name: backend
        skill: skills/build-backend/SKILL.md
        advisory: false   # failure blocks the group (default)
EOF

# Combine when: with parallel: to skip the entire group on S-tier:
cat >> .ai-conductor/config.yml << 'EOF'
steps:
  build:
    when: "tier in [M, L]"
    parallel:
      - name: unit-tests
      - name: integration-tests
        advisory: true    # failure is logged but group succeeds
EOF
```

Existing projects require no changes — both `when:` and `parallel:` are opt-in.

New optional config stanzas in `.ai-conductor/config.yml` to select non-default plugins:

```bash
# Select a custom LLM provider (must be discoverable via plugin.yml in plugin dirs)
# Default is 'claude' (ClaudeProvider built-in); omit to keep using ClaudeProvider
echo "llm_provider: my-custom-provider" >> .ai-conductor/config.yml

# Select a custom UI renderer (default is 'terminal'; omit to keep using TerminalSubscriber)
echo "ui_renderer: my-custom-renderer" >> .ai-conductor/config.yml

# Install a plugin by placing plugin.yml + entrypoint in either:
#   ~/.ai-conductor/plugins/<plugin-name>/   (global — all projects)
#   .ai-conductor/plugins/<plugin-name>/     (project-local — overrides global)
```

Existing projects require no changes — built-in defaults are preserved.

## [0.99.2] - 2026-04-19

## [0.99.1] - 2026-04-19

## [0.99.0] - 2026-04-18

## [0.4.1] - 2026-04-17

## [0.4.0] - 2026-04-12

## [0.3.0] - 2026-04-11` before merge — CI fails the release workflow if the block is
empty.

Categories:

- **Added** — new skills, hooks, gates, or capabilities.
- **Changed** — behavioral changes to existing skills, hooks, or CLI.
- **Fixed** — bug fixes, typo corrections, non-behavioral cleanup.
- **Removed** — skills, hooks, or flags that no longer exist.
- **Migration** — runnable steps needed when upgrading. Use a
  ` ```bash migration ` fenced block for commands `bin/migrate` should execute.

---

## [Unversioned] — pre-0.4.0 development

### Added

- `finish` step now has a custom completion predicate
  (`src/conductor/src/engine/artifacts.ts`) that requires either
  `state.pr_url` to be set or `.pipeline/finish-choice` to contain one of
  `pr | merge-local | keep | discard`. Without one, the conductor refuses
  to mark the step done — closing the silent-no-PR failure mode where
  print-mode finish exited with prose instead of acting.
- `auto-resume.ts` learns a new `kind: 'orphaned-state'` result, returned
  when project-root state is past the worktree step but no worktree exists
  at any conventional location (`.worktrees/<slug>` or
  `.claude/worktrees/<slug>`). `index.ts` surfaces a clear error with
  recovery instructions instead of silently resuming on main and landing
  artifacts on the wrong branch.
- `auto-resume` and the worktree scan now find worktrees under
  `.claude/worktrees/<slug>` in addition to `.worktrees/<slug>`, matching
  the convention used by Claude Code's IDE Conductor feature.
- TypeScript conductor rewrite (`src/conductor/`) — 3-layer architecture (Engine/Execution/UI) replacing the 3,100-line bash `bin/conduct`.
- `bin/conduct-ts` shell wrapper for the TypeScript conductor.
- 14-step state machine with typed events, gate enforcement, tier-based skipping, checkpoint handling, backward navigation, and recovery flow.
- LLM provider abstraction with Claude CLI adapter, session management, and rate limit handling.
- ink-based terminal UI: dashboard, checkpoint prompts, recovery menus, navigation menus.
- CLI entry point with commander: `--resume`, `--auto`, `--status`, `--from`, `--step`, `--reset`, `--cleanup`, `--output` flags.
- Worktree management: slugify, create, scan, cleanup with collision handling.
- 310 tests across 21 test files + 4 integration tests.
- Architecture diagrams (C4 levels 1-3) and architecture review for conductor rewrite.
- Phase 2 language evaluation choosing TypeScript over Python/Rust/Go.
- User validation checkpoints after build and manual-test steps in conductor.
- Backward navigation (`b = go back`) from checkpoints and recovery menu with numbered step menu.
- `stale` state marking (⚠) for downstream steps when revisiting earlier phases.
- `step_satisfied()` gate function — stale steps pass prerequisite checks but re-run when reached.
- Story catalog: 5 product epics and 36 feature stories specifying all harness behavior as Given/When/Then acceptance criteria.
- Design doc for pluggable harness architecture (phased rewrite: stories -> language eval -> conductor rewrite -> skill overrides -> UI abstraction).
- Implementation plan for Phase 1 (story catalog review and acceptance).
- Semver tagging system with CI-driven releases on merge to `main`.

### Changed

- `finish` step is now dispatched as an interactive Claude REPL in default
  mode (added to `INTERACTIVE_STEPS` in
  `src/conductor/src/engine/step-runners.ts`), not print mode. The skill
  asks the user to choose between Merge/PR/Keep/Discard; print mode
  silently swallowed that prompt and the conductor wrote `done` against
  no actual outcome. Auto mode still uses print mode and now relies on
  the new completion gate to enforce the result.
- `skills/finish/SKILL.md` requires the chosen option to be recorded:
  `.pipeline/finish-choice` for every outcome, plus `pr_url` written to
  `.pipeline/conduct-state.json` when the choice is "Push & PR". In
  unattended (print/auto) mode, the skill defaults to "Push & PR" rather
  than enumerating options to no-one.
- `README.md` reorganized around a "Choosing a Conductor" section: side-by-side
  comparison of `conduct` (stable bash, default) and `conduct-ts` (TypeScript
  rewrite, opt-in) covering install, CLI parity, dashboard, gates, auto-heal,
  and test coverage. Install section no longer implies the TS build is
  required.
- `bin/conduct` prints a one-time "conduct-ts is installed" heads-up the
  first time it runs on a machine where `conduct-ts` is on PATH, with a
  marker at `~/.ai-conductor/conduct-ts-notice-shown` so it never spams.
  `conduct --help` also now mentions `conduct-ts` at the bottom of its
  examples block. Neither changes default behavior — bash conduct stays
  the default.
- `VERSION` pinned to `0.99.0` to signal the harness is pre-1.0 while the
  TypeScript conductor rewrite stabilizes feature parity (notably the
  `--interactive` flag is still bash-only). CI-cut releases will continue
  on the 0.x line until conductor parity is declared complete.
- `run_manual_test()` now runs in print mode (automated) instead of interactive mode; harness checkpoint provides user review.
- `run_acceptance_specs()` now runs in print mode (automated) instead of interactive mode.
- Recovery menu expanded from `r/i/s/q` to `r/i/b/s/q` with backward navigation option.
- CLAUDE.md now requires Claude to present VERSION bump for user approval before creating a PR.
- `VERSION` and `CHANGELOG.md` as the source of truth for release cadence.
- `.github/workflows/release.yml` — auto-tag, rewrite changelog, bump version,
  create GitHub Release on every merge to `main`.
- `.github/pull_request_template.md` — scaffolds the Changelog + Migration
  sections for PRs against this repo. Does not affect consumer projects.
- `templates/claude-settings.json.template` and new `bootstrap` step 3d —
  bootstrap now emits a `.claude/settings.json` scoped to the project root
  (`Read`/`Edit`/`Write` under the bootstrapped directory, including
  dotfiles) so downstream skills don't block on permission prompts when
  they touch harness artifacts.
- `bin/install` now symlinks `conduct-ts` into `~/.local/bin` alongside
  the bash `conduct` when `src/conductor/dist/index.js` is present.
  `bin/conduct-ts` resolves its own path via `readlink -f` so the
  symlink works, and it honors the conductor-pinned Node version via
  `ASDF_NODEJS_VERSION` (reading `src/conductor/.tool-versions`) so
  users with an older default Node don't hit the `addAbortListener`
  import error from execa.
- Build-step stall circuit breaker + auto-interactive handoff. After a
  completion-gate miss, the conductor compares the resolved-task count
  (`completed` + `skipped` in `.pipeline/task-status.json`) before and
  after the attempt. If two consecutive retries produce zero new
  completions, or if the pipeline skill wrote
  `.pipeline/halt-user-input-required`, the conductor stops retrying,
  emits a `build_stall` event, clears the halt marker, and dispatches
  an interactive Claude REPL for the build step so the user can unblock
  whatever autonomous retry couldn't decide. Re-checks the completion
  predicate once the REPL exits — if passing, step succeeds; if still
  failing, falls into the existing recovery menu.
  Closes the failure mode where Claude's build output contains a
  rhetorical "here are three options, what would you prefer?" question
  that no amount of automated retry could resolve. 14 new tests
  (10 unit in task-progress, 4 integration in conductor).
- `skills/pipeline/SKILL.md` — new "Halt-and-Escalate" section
  documenting the `.pipeline/halt-user-input-required` marker contract.
  Pipeline writes it when it knows it needs user judgement (scope
  mismatch, ambiguous requirement, etc.) rather than guessing via a
  rhetorical output question.
- Additive `build_stall` event on `ConductorEvent` (step, reason:
  `no_task_progress | halt_marker`, resolvedBefore, resolvedAfter).
  `TerminalSubscriber` forwards it.
- Conductor skips already-resolved steps on every run. Steps marked
  `done` or `skipped` in `.pipeline/conduct-state.json` are no longer
  re-dispatched when `conduct-ts` is invoked against a project with
  existing progress (e.g. after a terminal close, a crash, or a fresh
  invocation that skipped `--resume`). Previously the main loop
  iterated ALL_STEPS unconditionally, so a re-invocation without
  `--resume` re-ran `worktree`, `memory`, `brainstorm`, etc. from the
  top even though those steps were already `done`. `failed` steps are
  still re-entered so the recovery flow can continue; `--from <step>`
  still forces a re-run of the targeted step regardless of status.
  Observed in the focus-timer-api test: build failed at 7/21 tasks,
  user re-invoked, conductor restarted at `worktree` — now it skips
  everything and lands back on `build`.
- Pre-flight `ensureClaudeSettings(projectRoot)` at conductor startup.
  Before any Claude dispatch, `conduct-ts` checks for
  `$PROJECT_ROOT/.claude/settings.json`; if absent, it writes one with
  project-scoped Read/Edit/Write rules plus a baseline Bash allow-list
  for harness tooling (`git`, `gh`, `rtk`, `npm`, `npx`, `node`, `mkdir`,
  `touch`, `chmod`, `ln`, `glow`). Solves the chicken-and-egg where
  bootstrap is supposed to write its own permission file (step 3d-i)
  but can't do so without permission to write. Stack-specific tooling
  (bundle, rails, pytest, cargo, go…) is intentionally NOT in the
  baseline — bootstrap adds those per detected stack so dead rules
  don't accumulate. Idempotent — existing files are preserved, so user
  customizations and bootstrap's own generation on a later run remain
  authoritative. 10 unit tests cover create-if-missing /
  never-overwrite / scope-correctness / baseline-Bash-allows /
  no-stack-specific-pollution.
- `INTERACTIVE_STEPS` — conversational steps (`brainstorm`, `stories`,
  `plan`, `architecture_review`, `manual_test`) now open a real Claude
  REPL (positional prompt, no `-p`) instead of one-shot print mode,
  unless the conductor was invoked with `--auto`. The design of these
  skills depends on back-and-forth with the user — one-shot print
  closed the session after a single Claude response, so the user
  couldn't refine scope or iterate. One-shot steps (`complexity`,
  `conflict_check`, `architecture_diagram`, `retro`, `finish`) stay
  print-mode — they generate artifacts from existing context without
  user input. `--auto` still forces print mode for everything so
  unattended runs don't block waiting for `/quit`. New `mode: RunMode`
  option on `StepRunnerOptions`; threaded from `src/index.ts` based on
  `--auto` flag. 12 unit tests covering the REPL dispatch matrix.
- `bootstrap_mode` state field + `mode_skip` event. Bootstrap now persists
  the detected mode (`new` / `fresh` / `partial` / `re-bootstrap`) into
  `.pipeline/conduct-state.json`. When mode is `new` the conductor
  skips `assess` with a `mode_skip` event (the 9 CTO specialists have
  no codebase to evaluate on an empty-directory scaffold). Other modes
  run `assess` normally. Closes the "assess silently loops and fails"
  failure mode observed in the focus-timer-api test run.
- `src/conductor/README.md` — new architectural overview for the
  TypeScript conductor (layout, state machine, events,
  bootstrap-mode-skip, auto-heal, pinned Node, testing pattern).
- `README.md` updated: TypeScript Conductor section, project structure
  includes `src/conductor/`, "What Your Project Gets" includes
  `.claude/settings.json`, lint hook explanation, step count corrected
  from 14 to 16.
- `bootstrap` step 3d-ii — pre-PR lint hook. Bootstrap now detects the
  project's lint command (stack-specific table: npm + tsc, rubocop +
  sorbet, ruff + mypy, clippy, go vet) and writes a `PreToolUse` hook in
  `.claude/settings.json` that runs the command before any
  `gh pr create` invocation. Non-zero exit blocks the PR. Linting is
  now deterministic harness machinery — TDD, pipeline, and code-review
  skills no longer invoke the linter themselves. Users can edit the
  hook command in `.claude/settings.json` at any time; re-running
  bootstrap is idempotent.
- `bin/migrate` — self-configuring migration runner that reads the current
  version from `~/.claude/ai-conductor.config.json`, re-runs
  `bin/install --update`, and executes any `## Migration` bash blocks from the
  changelog entries between the old and new version.
- `bin/install --update` — idempotent refresh path that skips the first-run
  dependency bootstrap and the channel-selection prompt.
- `~/.claude/ai-conductor.config.json` — user-facing config for the update
  channel (`tagged` vs `main`), current version, and auto-check preference.
- `conduct --set-channel {tagged|main}` — switch update channels without
  re-running install.
- Conductor-TS UI abstractions: `UISubscriber`, `UIEventHandler`,
  `DashboardSnapshot`, `RenderPayload`, and `UIPromptHost` in
  `src/conductor/src/ui/types.ts`; `TerminalPromptHost` reference
  implementation in `src/ui/terminal/prompt-host.ts`.
- `buildDashboardSnapshot(...)` pure builder split out from
  `renderDashboardLines`, enabling future non-terminal renderers to
  consume structured data instead of parsing strings.
- `chalk` + `ora` dependencies in `src/conductor/package.json`; colored
  dashboard output and an `ora` countdown spinner on `rate_limit` events.
- Current-step banner (step label + HH:MM:SS start time) on the dashboard
  and a post-step `lastStepTail` pane showing the last N lines of the
  previous step's captured stdout.
- `--view full|focus|log` and `--tail-lines <n>` flags on `bin/conduct-ts`.
- Optional `tail?: string[]` field on `step_completed` events (last 200
  lines of captured output; backwards-compatible additive).

### Changed

- `check_harness_update()` in `bin/conduct` is channel-aware: on the `tagged`
  channel it checks for the latest `vX.Y.Z` git tag, renders the changelog
  block via `glow` before prompting, and calls `bin/migrate` on approval.
- `HARNESS.md` now documents the update flow in a new "Harness Updates" section.
- `CLAUDE.md` (harness-repo-level) documents the new release and update gates.
- Conductor-TS readline prompts (checkpoint, recovery, artifact review,
  complexity, navigation) consolidated behind `TerminalPromptHost` instead
  of being scattered top-level functions in `src/conductor/src/index.ts`.
  `ConductorOptions` shape is unchanged — the engine contract is stable.
- `renderDashboardLines` now delegates through the snapshot builder +
  `formatDashboardSnapshot` formatter. Public signature preserved; string
  output is identical apart from additive color on TTY.
- Dashboard step-started transient line shows the step's display label
  (e.g. `Brainstorm`) instead of the raw step name (`brainstorm`).

### Migration

No migration steps required when upgrading from 0.3.0 — the new update flow
takes effect on the next `conduct` run after this release is installed.

### Fixed

- Conductor-spawned Claude sessions no longer inherit the user's global
  `permissions.defaultMode`. `SessionManager.buildClaudeArgs()` in
  `src/conductor/src/execution/session.ts` now explicitly passes
  `--permission-mode default` for interactive step invocations (which
  previously passed nothing and fell through to whatever the user had
  globally). This was silently breaking interactive steps like
  `/brainstorm`, `/stories`, `/plan` for users whose global
  `~/.claude/settings.json` had `"defaultMode": "plan"` — those sessions
  booted into plan mode and the skill could not write its required
  `.docs/specs/`, `.docs/stories/`, or `.docs/plans/` artifacts. Non-
  interactive invocations are unaffected (they already pass
  `--dangerously-skip-permissions`).
- Feature-level state (manual-test, retro, etc.) no longer bleeds across features in root state file; project-level steps (bootstrap, assess) persist correctly.
- Task progress counter shows correct total from the start (0/10, 1/10) instead of growing denominator (1/1, 2/2).
- `bin/conduct-ts` autonomous Claude invocations no longer print
  `Warning: no stdin data received in 3s, proceeding without it.` — the
  provider now passes `stdin: 'ignore'` to execa on the print-mode path.
- Conductor auto-heals `.pipeline/task-status.json` drift before
  re-invoking the build step. When the completion gate fails with
  "tasks not completed", the engine reconciles each pending task against
  the current branch's git log (commit-message + touched-file match); any
  task with unambiguous prior-run evidence is flipped to "completed"
  in-place and the gate re-checks without a Claude retry. Audit trail
  under `.pipeline/audit-trail/autoheal-*.json`. Runs once per session
  per step; scoped to `build`; silently skips when git is absent.
  Additive `auto_heal` event on `ConductorEvent` for UI visibility.
- `skills/pipeline/SKILL.md` — orchestrator-writes-review.json gate tightened:
  after each batch evaluator returns, the orchestrator must atomically
  `mkdir -p`, write `.pipeline/audit-trail/batch-N/review.json`, and
  stat-check the file before advancing. Missing or empty file is a hard
  halt. Closes the "silently bypassed 4 evaluator gates" failure mode.
- `skills/pipeline/SKILL.md` — Pipeline Entry Guard added: if every task
  is already `completed`/`skipped`, the skill early-exits with a one-line
  progress.log note instead of loading the plan and dispatching work.
  Prevents token burn on crashed-then-resumed sessions that already
  finished.
- `skills/pipeline/SKILL.md` — `.pipeline/summary.json` is now required
  at final-task completion (fields: plan_ref, complexity_tier, autonomy,
  task counts, batch counts, rework cycles, interventions, timestamps,
  first/last commit SHAs). Retro consumes this file instead of
  recomputing stats via an Explore agent.
- `skills/pipeline/SKILL.md` — Evaluator model table added: Medium-tier
  intermediate batch evaluators run on Sonnet (not Opus); only the final
  batch evaluator runs on Opus. Small stays Sonnet-only. Large keeps
  Opus throughout.

### Removed

- Dead Ink/React terminal components and their tests
  (`src/conductor/src/ui/terminal/*.tsx`,
  `src/conductor/test/ui/terminal/*.test.tsx`) — superseded by the
  text-based live-region renderer.
- `ink`, `react`, `ink-testing-library` dependencies from
  `src/conductor/package.json` (`react` peerDeps removed too); the
  `"jsx": "react-jsx"` compiler option is dropped from
  `src/conductor/tsconfig.json`.

---

## [0.3.0] - 2026-04-11

Retroactive entry capturing the state of the harness at the point the
versioned release flow was introduced.

### Added

- Full SDLC skill suite: bootstrap, brainstorm, stories, plan,
  architecture-diagram, architecture-review, writing-system-tests, tdd,
  pipeline, code-review, simplify, debugging, manual-test, finish, pr, retro,
  conduct, assess, conflict-check, memory.
- `bin/conduct` orchestrator with phase detection and gate enforcement.
- `bin/install` with symlink-based skill installation, settings.json
  permission/hook wiring, and dependency bootstrap (glow, rtk, puppeteer MCP).
- Hook suite under `hooks/claude/` for destructive-git blocking, TDD commit
  gating, lint-after-edit, spec/diagram coverage, rate-limit handling, session
  start context loading, and stop-memory reminders.
- `test/test_harness_integrity.sh` validation suite covering bash syntax,
  SKILL.md frontmatter, agent references, cross-skill references, HARNESS.md
  model table, template references, and section numbering.
- `HARNESS.md` as the single source of truth for project-facing behavioral
  rules, consumed by every project using the harness.
