**Status:** Accepted

# Stories: The SHIP tail authors the release waiver the release gate validates

Source: jstoup111/ai-conductor#2230

Operator acceptance: Approved in the composer session, 2026-09-22.

## Scope and authority

Technical track, Medium tier. The operator approved balanced scope, approach A, the sequence diagram, the lightweight architecture review, and amendment D4–D6 to adr-2026-07-06-migration-gate-waiver. The path-based breaking-surface classifier, `version-signal.ts`, consumer pipelines, and plan-time waiver authoring are out of scope.

| Requirement | Approved outcome | Stories |
|-------------|------------------|---------|
| TR-1 | The self-host `release-disposition` step records exactly one surface verdict from `none`, `migration`, `waiver`, `unclassifiable` for the real feature diff (D4) | 1, 2, 3 |
| TR-2 | A `waiver` verdict leaves exactly one gate-valid waiver naming every classified surface committed in the feature diff before the step passes — reusing or amending a waiver already in the diff rather than adding a second — so an internal-only build reaches finish without an operator halt and the waiver is in the PR diff for merge review (D5) | 1 |
| TR-3 | A `migration` verdict writes a runnable migration block to the retained draft PR body and authors no waiver; a change to a `bin/conduct` subcommand, flag, or behavior, a hook contract, or a `settings.json` schema is never judged `waiver` (D5) | 2 |
| TR-4 | An `unclassifiable` verdict authors nothing and the release gate halts exactly as today (D6) | 3 |

## Story 1: An internal-only breaking-surface touch ships with a committed waiver

**Requirement:** TR-1, TR-2

As an operator, I want a self-host build whose only flagged surface is an internal-only edit to reach finish with a waiver I can review on the PR, so that I am not pulled in to hand-write the waiver.

### Acceptance Criteria

#### Happy Path
- Given a self-host feature diff whose only classified breaking surface is an edit to an already-wired hook script that changes no hook contract or wiring, when `release-disposition` runs, then it records the surface verdict `waiver`, commits a waiver for the feature's plan stem that lists `hook wiring` with a non-empty rationale, and writes its pass marker only after that commit exists on the feature branch.
- Given the waiver was committed by `release-disposition`, when the release gate runs before finish, then the gate passes on the waiver without writing a HALT and finish is dispatched, with the waiver file present in the feature's `base...HEAD` diff for operator review before merge.
- Given a diff whose classified breaking surfaces are `hook wiring` and `bin/conduct CLI`, where the hook edit changes no contract or wiring and the `bin/conduct` edit deletes only a private helper with no subcommand, flag, or behavior change, when `release-disposition` records `waiver`, then the committed waiver lists both canonical surface names and the release gate passes.
- Given the feature diff already contains a committed waiver that lists every classified surface with a non-empty rationale, when `release-disposition` records `waiver`, then it adds no second waiver, treats nothing-to-commit as success, writes its pass marker, and the release gate passes on that waiver.

#### Negative Paths
- Given `release-disposition` wrote the waiver file but its commit failed, when the step finishes, then it reports BLOCKED, leaves the pass marker absent, and the feature does not reach finish.
- Given a committed waiver that lists only `hook wiring` while the diff also touches `settings.json schema`, when the release gate runs, then it halts naming `settings.json schema` as uncovered and finish is not dispatched.
- Given the feature diff already contains a committed waiver that omits a classified surface, when `release-disposition` records `waiver`, then it amends and commits that same waiver file to list every classified surface instead of adding a second waiver file, and the feature diff contains exactly one waiver.
- Given a waiver for the same plan stem already exists on the base branch from an earlier merge, when this feature's `release-disposition` records `waiver`, then it commits the waiver in this feature's diff, and without that commit the release gate halts as not committed with this change set.
- Given a feature diff with no classified breaking surface, when `release-disposition` runs, then it records `none`, commits no waiver, and the release gate passes.

### Done When
- [ ] The repository-local `release-disposition` skill contract requires one surface verdict from the closed set `none | migration | waiver | unclassifiable`, requires a `waiver` verdict to commit the waiver under `.docs/release-waivers/` before writing `.pipeline/release-disposition-pass`, and requires reusing or amending a waiver already in the feature diff instead of adding a second, asserted by `release-disposition-contract.test.ts`.
- [ ] A release-gate test with a change set containing a hook-script edit plus a committed waiver listing `hook wiring` returns `ok: true` and writes no HALT.
- [ ] A release-gate test whose committed waiver omits a classified surface returns `ok: false` with a reason naming the uncovered surface.

## Story 2: A consumer-action surface gets a runnable migration block, not a waiver

**Requirement:** TR-1, TR-3

As an operator, I want a change that consumers must act on to carry a real migration block, so that an autonomous waiver never hides a required consumer migration.

### Acceptance Criteria

#### Happy Path
- Given a self-host feature diff that changes a breaking surface consumers must act on, when `release-disposition` runs, then it records `migration`, writes a `note` disposition with a runnable `bash migration` block under `## Migration` in the retained draft PR body, and commits no waiver.
- Given that migration block is in the retained draft PR body, when the release gate runs before finish, then it passes without a HALT.

#### Negative Paths
- Given `release-disposition` records `migration`, when the step finishes, then no file under `.docs/release-waivers/` is added or modified in the feature diff by that step.
- Given a feature diff that changes a `bin/conduct` subcommand, flag, or behavior, a hook contract, or a `settings.json` schema, when `release-disposition` runs, then it records `migration`, or `unclassifiable` when it cannot determine the consumer action, and never records `waiver`.
- Given the retained draft PR body carries a `note` disposition whose `## Migration` section has no runnable `bash migration` fence and no waiver is committed, when the SHIP tail reaches the release gate before finish, then it halts with the malformed-release-disposition reason, the release gate is not evaluated, and finish is not dispatched.

### Done When
- [ ] The `release-disposition` skill contract directs a `migration` verdict to a runnable migration block in the PR body, forbids authoring a waiver for that verdict, and forbids a `waiver` verdict for a `bin/conduct` subcommand, flag, or behavior change, a hook contract change, or a `settings.json` schema change, asserted by `release-disposition-contract.test.ts`.
- [ ] A release-gate test with a breaking change set, a runnable migration block in the release metadata, and no waiver returns `ok: true`.

## Story 3: An unclassifiable surface halts exactly as today

**Requirement:** TR-1, TR-4

As an operator, I want a breaking surface the pipeline cannot confidently classify to stop for me, so that uncertainty never ships on an autonomous judgement.

### Acceptance Criteria

#### Happy Path
- Given a self-host feature diff with a classified breaking surface and no waiver committed in the feature diff, that `release-disposition` cannot confidently judge internal-only or consumer-facing, when the step runs, then it records `unclassifiable` and authors neither a waiver nor a migration block.
- Given that `unclassifiable` outcome, when the release gate runs before finish, then it writes the same needs-human HALT with the same migration-block-required and missing-waiver reason it writes today, and finish is not dispatched.

#### Negative Paths
- Given the feature's change set cannot be determined, when the release gate runs, then it halts fail-closed even if a waiver file is present, and the reason does not offer the waiver path.
- Given the step's review evidence records a surface verdict outside `none`, `migration`, `waiver`, `unclassifiable`, when the step finishes, then it reports BLOCKED and leaves the pass marker absent.

### Done When
- [ ] The `release-disposition` skill contract states that `unclassifiable` authors neither a waiver nor a migration block and that a verdict outside the closed set is BLOCKED with the pass marker absent, asserted by `release-disposition-contract.test.ts`.
- [ ] A release-gate test with a breaking change set, no migration block, and no waiver returns `ok: false` with a reason equal to today's migration-block-required plus missing-waiver text.
- [ ] A release-gate test with a null change set and a waiver file present returns `ok: false` with a reason that does not mention `.docs/release-waivers/`.
