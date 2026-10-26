---
title: Validation
parent: Contributing
nav_order: 5
---

# Validation

The structural integrity suite — `test/test_harness_integrity.sh` — check by check: what each one
verifies, what makes it fail, and how to fix it. For contributors whose commit just went red.

This page covers the integrity script only. Runtime gates that block a feature's progression are
[gates](../explanation/gates.md); per-step enforcement values are [steps](../reference/steps.md).

## Running it

```bash
bash test/test_harness_integrity.sh
```

Run it from the worktree root. It takes no arguments. In managed self-host runs, the BUILD
`test_suite` gate owns this suite; other steps consume its evidence instead of rerunning it.
For an operator-requested hotfix outside the lifecycle, run it once on the completed
change. A file edit or step completion is not a separate suite trigger. The `test_suite`
gate owns this integrity suite alongside the aggregate application tests.

Two result classes:

- `assert` failures print `FAIL`, increment the failure count, and make the script exit 1.
- `warn_check` failures print `WARN` and are counted separately. They **never** change the exit code.

The summary line reports `N passed  N failed  N warnings  (N total)`. Only the failure count matters for
exit status.

A failing check is reported and the run continues to the summary. If an unguarded command fails
instead, the script stops before the summary and prints
`ABORT: unguarded command failed at line <N> (exit <status>)` to stderr. That line names a script
defect, not a check result: capture the command's status and pass it to `assert` or `warn_check`
(check 29 enforces this).

Install engine dependencies and `jq` first, or checks 5a, 5b, and 5c fail:

```bash
cd src/conductor && npm ci
```

`test/check_integrity_prerequisites.sh` guards those checks. Without `src/conductor/node_modules`, each
of 5a, 5b, and 5c reports a `FAIL` that includes this line, and the run continues to later sections:

```text
Missing src/conductor/node_modules; run npm ci in src/conductor before running integrity model-table checks.
```

Check 5b also needs `jq` on `PATH`; without it, the check fails with
`Missing jq; install jq before running the model-table pin integrity check.`

## The checks

In file order. Sections 1, 2, 5, and 9 carry lettered sub-checks, and four checks are unnumbered in the script.

| # | Verifies | Fails when | Fix |
| --- | --- | --- | --- |
| — | The repository root has no `package-lock.json`. The Node project lives under `src/conductor/`; a root lockfile would describe no installable package and mislead dependency tooling about that boundary. | `package-lock.json` exists at the repository root. | Remove the stray root lockfile; run `npm ci` inside `src/conductor/` instead. |
| 1 | `bash -n` over `bin/**` (only files whose first line has a shell shebang), `hooks/**/*.sh`, `test/*.sh`, and `.github/scripts/*.sh`, as enumerated by `test/lint_shell.sh`. | Any of those scripts has a syntax error. | Fix the syntax. A `bin/` file with a non-shell shebang is skipped entirely, not checked. |
| 1b | ShellCheck at `--severity=error` over the same script set: `bin/**` by shell shebang, plus `hooks/**/*.sh`, `test/*.sh`, and `.github/scripts/*.sh`. Where check 1 proves a script *parses*, this catches shell bugs that parse fine and misbehave at runtime. | Any finding at `error` severity (exit 1), or the enumeration returns zero scripts (exit 2 — the gate refuses to report success on an empty set). | Run `test/lint_shell.sh` and fix what it names. Threshold and deferred warning/info/style counts are documented in that script's header. |
| 1c | No tracked text source file (`.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.json`, `.sh`, `.md`, `.yml`, `.yaml`) contains a raw NUL byte. A committed NUL makes the file *binary* to the whole search toolchain, and every tool fails silently: `grep` (shimmed to `ugrep -I` in agent sessions) and recursive `rg` skip it entirely — no match, no count line, no warning, exit 1. That reads as "the symbol does not exist", which has already caused a live misdiagnosis (2026-08-20, `build-review-domain.ts:84`). | Any listed file contains a NUL byte. | Replace the raw byte with the `\u0000` escape, which is semantically identical: `perl -0777 -pi -e 's/\000/\\u0000/g' <file>`. Detection is by construction (stripping NULs changes the file iff it had one) because a NUL cannot be passed as a `grep` pattern argument at all. |
| 2 | Every `skills/*/SKILL.md` opens with `---` and its frontmatter contains `name:`, `description:`, `enforcement:`, `phase:`. | The delimiter or any required field is missing. | Add the field. See [skills](../reference/skills.md). |
| 2a | `test/check_skill_invocation_policy.sh` verifies every shipped and repository-local skill has exactly one invocation classification, and `test/test_skill_invocation_policy.sh` mutation-tests that audit. The fixed implicit-required set carries one canonical `implicit_invocation: required` marker and no host disable; every other skill carries Claude `disable-model-invocation: true` plus Codex `policy.allow_implicit_invocation: false`. The observed exception set must exactly equal the verified same-session dependency allowlist. | A host policy is missing, duplicated, noncanonical, or contradictory; a local skill is omitted; the implicit-required set drifts in either direction; or the checker accepts a representative invalid mutation. | Classify the caller first. Keep implicit invocation only when another loaded skill must activate the workflow in the same session; otherwise add both host disable controls. Update the fixed allowlist and [skills reference](../reference/skills.md#invocation-policy) together when a verified composition dependency changes. |
| 3 | Every `agents/[a-z_-]*.md` string appearing in `skills/`, `HARNESS.md`, or `ARCHITECTURE.md` exists on disk. | A referenced agent file is missing. | Create the agent file or fix the reference. |
| 4 | Every backticked `` `/name` `` reference in `skills/*/SKILL.md` maps to a `skills/<name>/` directory, or is named in the script's `KNOWN_NON_SKILL_REFS` allowlist (`quit`, `skill-name`). | A reference resolves to no skill directory and is not allowlisted — a dangling pointer left behind by a renamed or deleted skill. | Fix the reference to name a real skill, or — if it genuinely names a host command or a syntax placeholder, not a skill — add it to `KNOWN_NON_SKILL_REFS` with a comment naming where it is used. |
| 5 | `test/check_model_table_presence.sh` resolves every `skills/*/SKILL.md` to an `ARCHITECTURE.md` table row by exact first-cell name, ignoring a trailing parenthetical. A skill without its own row passes through a reasoned `ROW_ALIASES` entry whose rows all exist (`tdd` → `tdd-red`,`tdd-green`) or a reasoned `SKILL_NO_ROW_ALLOWLIST` entry (`engineer`; `coverage-binding`, the plan skill's coverage-judge policy with no engine step). `test/test_model_table_presence.sh` runs fixtures that cover each resolution path. | A skill resolves to no row, alias, or allowlist entry; an alias or allowlist entry has an empty reason; an allowlist entry names a missing skill directory; or the fixture spec fails. | Add a model-table row and regenerate. Use an alias only when the row is spelled differently, and use the allowlist only for a skill that has no row on purpose. Give every entry a reason. |
| 5a | `bin/generate-model-table --check` reports no drift between the generated ARCHITECTURE.md table region and `model-table-metadata.ts` + `resolved-config.ts`. Plus a fixture sub-test that corrupts a temp copy's Codex provider label and requires exit 1 *and* a unified diff naming both the changed and the canonical header line. | Exit 1 (drift), exit 2 (environment error), or any other non-zero exit. The fixture fails if `--check` cannot produce a useful diff. | Run `bin/generate-model-table` and commit the rewritten ARCHITECTURE.md region. Never hand-edit rows between the `BEGIN GENERATED: model-selection-table` and `END GENERATED` markers. |
| 5b | `test/check_skill_model_pins.sh` compares SKILL.md `model:` frontmatter pins with `bin/generate-model-table --pins` in both directions. Every pin must equal its entry's `.expected`, and every non-exempt `--pins` entry must have a `skills/<name>/SKILL.md` pinned to `.expected`. Entries with `.exempt == true` pass without comparison. `test/test_skill_model_pins.sh` runs the fixture spec. | Any pin disagrees with its expected value; a pinned skill is absent from `--pins` (reported as "unmapped"); an expected skill has no SKILL.md or no `model:` pin; `--pins` emits unparseable JSON; the fixture spec fails; or `node_modules` or `jq` is missing. | Fix the pin, or map the skill in `SKILL_STEP_MAP` / exempt it in `PIN_EXEMPT_SKILLS` (`src/conductor/src/engine/model-table-metadata.ts`). |
| 5c | `bin/generate-docs-guard-hook --check` reports no drift between the committed `hooks/claude/docs-guard.sh` and `src/conductor/src/engine/session-hook-assets.ts`. Plus `test/check_docs_guard_drift_fixture.sh`, which appends a corrupting comment to a temporary copy of the hook and requires `--check` against that copy (via `GENERATE_DOCS_GUARD_HOOK_OUT`) to exit 1. The tracked hook is never modified. `test/test_docs_guard_drift_fixture.sh` verifies that the fixture leaves the tracked hook intact and fails on a broken generator override or a failed temporary copy. | Exit 1, 2, or any other non-zero exit; the corrupted copy is not detected; the fixture spec fails; or `node_modules` is missing. | Edit the TypeScript source, run `bin/generate-docs-guard-hook`, commit the regenerated `.sh`. Never hand-edit the hook. |
| 6 | Every `templates/[a-z_.-]*.template` string in `skills/`, `HARNESS.md`, or `ARCHITECTURE.md` exists on disk. | A referenced template is missing. | Create it or fix the reference. |
| 7 | Per SKILL.md, no two `### <n>` headings share an identifier. Sub-markers are kept, so `### 2.` and `### 2.5` — or `### 3.` and `### 3a.` — do not collide. | Two headings resolve to the same identifier. | Renumber. |
| 8 | Zero matches for `embed(`, `cosineSimilarity`, `vectorSearch`, `relevanceScore`, or `rankScore` across `src/conductor/src`, `bin`, `hooks`, and `skills`, excluding any `engineer` directory. | Any harness-side embedding, vector-search, or relevance/rank-scoring logic exists for the memory subsystem. | Remove it. Recall is performed by the LLM reading the store, not by harness-side retrieval. |
| 9a | `VERSION` exists and matches `^[0-9]+\.[0-9]+\.[0-9]+$`. | Missing or malformed. | Fix `VERSION`. See [releases](releases.md). |
| 9b | `CHANGELOG.md` exists and contains a line matching `^## \[Unreleased\]`. | The file or the header is absent. Content may be empty. | Restore the header. |
| 9d | `skills/pipeline/SKILL.md` contains, case-insensitively, `user-requested exit during a run` **and** the literal `halt-user-input-required`. | Either string is gone. | Restore the contract text and keep the marker name in sync with `engine/artifacts.ts`. Without it, the build gate cannot distinguish a clean pipeline exit from an operator-requested halt. |
| 9e | `skills/stories/SKILL.md` matches `Status[^A-Za-z]*Accepted`. | The token is missing. | Restore the `Status: Accepted` instruction. The engineer land gate and the daemon backlog both require it; a stories file without it is skipped forever, silently. |
| 9f | `templates/adr.md.template`'s `**Status:**` line offers only pipe-delimited values whose leading word (uppercased) is `APPROVED` or `SUPERSEDED` — a terminal annotation like `SUPERSEDED by <slug>` stays valid. | Any offered status normalizes to something else, e.g. `Proposed` or `Accepted`. | Restore the template to offer only `APPROVED \| SUPERSEDED by {{superseding-adr-slug}}`. An offered value the `adrApprovalStatus` parser rejects would fail every new ADR at land and at daemon discovery. |
| 9g | `skills/architecture-review/SKILL.md` contains all four of `ai-conductor overlap-scan`, `Wiring Surface`, `advisory` (any case), and `/plan`. | Any one is missing. | Restore all four. |
| 9c | Every `git tag -l 'v*.*.*'` has a matching `^## \[<version>\]` section in `CHANGELOG.md`. Runs only when `.git` is a directory and `CHANGELOG.md` exists. | A released tag has no changelog section. | Add the section. |
| 10 | `test/check_task_status_writers.sh` checks that nothing outside the engine writes `.pipeline/task-status.json`. It greps `task-status` in `hooks/`, `bin/`, and `skills/` (`*.sh`, `*.ts`, `*.js`), drops comment/console/log/`readFile` lines and quoted literals, then flags anything matching `writeFile`, `.write`, `fs.write`, `fs.appendFile`, `>>`, or `>`. It also flags any `skills/*/SKILL.md` line that names `task-status.json` and `completed` or `skipped` and starts with an imperative verb such as `set`, `mark`, `write`, or `update`. `test/test_task_status_writers.sh` runs the fixture spec. | A non-engine writer or a non-allowlisted SKILL.md write instruction is found; a prose allowlist entry has an empty reason; or the fixture spec fails. | Route the write through `src/conductor/src/engine/`, and rewrite the skill text so it no longer tells agents to write task state. The engine is the sole authority on task-completion state. |
| — | `skills/pipeline/SKILL.md` does **not** match `(^\|[^\`])Run \`ai-conductor task (start\|done)`. | Imperative per-task CLI stamping text is present. | Rewrite descriptively — the skill documents session-hook machinery, not an imperative step. Mentions of the CLI as operator or recovery machinery are fine. |
| — | `skills/pipeline/SKILL.md` keeps an evaluator-free batch boundary: it names `BATCH_AFFECTED_TESTS`, `simplify`, the linter, and the orphaned-caller check, and contains none of `HARD GATE: Evaluator dispatch`, `closeout-event`, or `batches_with_evaluator`. Fixtures that re-add the evaluator hard gate or a `closeout-event` call must fail the predicate. | A required batch-boundary term is missing, a retired evaluator or closeout term is present, or a re-added-term fixture still passes. | Restore the batch-boundary checks and remove the retired evaluator gate or `closeout-event` text. Post-build review belongs to `build_review`. |
| — | No `skills/*/SKILL.md`, `agents/*.md`, `templates/*.template`, or `HARNESS.md` claims that a pipeline or batch evaluator satisfies the code-review gate, or that it will catch a defect. A fixture appending such a claim must fail the predicate. | The file and line holding the claim are printed. | Reword the claim. Pipeline and batch evaluators are advisory; they substitute for neither `/code-review` nor `build_review`. |
| 11 | Every `.github/ISSUE_TEMPLATE/*.yml` and `*.yaml` parses as YAML, and `config.yml`'s `blank_issues_enabled` is not `false`. Parses with python3 + pyyaml, falling back to node + js-yaml; WARN-skips when neither is available. | A template is invalid YAML, or `blank_issues_enabled: false` is set. | Fix the YAML. Leave `blank_issues_enabled` unset or true. |
| — | Every `.docs/intake/*.md` matches `^Owner:[[:space:]]*[^[:space:]]+`. | A hand-authored intake doc lacks an `Owner:` line. | Stamp `Owner:`. Authoring normally does this at write time; this is a belt on hand-written docs. |
| 12 | `skills/plan/SKILL.md` contains `ai-conductor overlap-scan` and, case-insensitively, `advisory`. | Either is missing. | Restore the overlap-scan step and its advisory wording. |
| 13 | `bash test/test_ci_detect_docs_only.sh` exits 0. | The docs-only CI predicate in `.github/scripts/ci-detect-docs-only.sh` regressed. | Fix the predicate; the failing assertions are printed inline. |
| 14 | `bash test/test_provider_skill_contracts.sh` exits 0. | An unscoped Claude-specific command, model, tool, delegation, or interaction — or a weakened shared gate — was reintroduced into a canonical skill. | Rescope the skill text so both hosts can load it. See [multiprovider](../guides/multiprovider.md). |
| 15 | `AGENT_INSTRUCTIONS.md` is a regular file, and both `CLAUDE.md` and `AGENTS.md` are symlinks whose `readlink` is exactly `AGENT_INSTRUCTIONS.md`. | Either symlink is missing, replaced by a regular file, or retargeted. | `ln -sf AGENT_INSTRUCTIONS.md CLAUDE.md` and `ln -sf AGENT_INSTRUCTIONS.md AGENTS.md`. |
| 16 | `test/check_halt_writers.sh` — a lexical scan of `src/conductor/src` for production code that writes `.pipeline/HALT` (directly, via a local alias, or across a multiline call) outside `engine/halt-marker.ts`, plus its own fixture suite covering constant, multiline, alias-variable, and literal-path violations. | The script exits non-zero: a real violation is found, or a fixture the scanner is supposed to catch is missed. | Route the write through `writeHaltMarker` in `src/conductor/src/engine/halt-marker.ts` instead of writing the file directly. |
| 16b | `test/check_shell_test_classification.sh` (every `test/*.sh` script is classified in `test/shell_tests.manifest` and each declared parent really invokes it), plus the fixture suites `test/test_shell_test_classification.sh` and `test/test_run_shell_tests.sh`. | Any script exits non-zero or is missing: an unclassified, stale, duplicate, invalid, reasonless, or unverified entry, or a fixture regression. | Add or correct the script's manifest line. See [Bash test scripts](testing.md#bash-test-scripts). |
| 17 | `test/test_docs_navigation.sh --site-contract` (fixture and real-tree hosted-documentation navigation contracts) and `test/test_docs_pages_smoke.sh` (deterministic Pages adapter contracts, `gh` and `curl` replaced at the process boundary). | Either script exits non-zero, or either script is missing. | Fix the reported navigation or adapter contract violation. The real Pages HTTP probe is a separate opt-in smoke test, never run from integrity. |
| 19 | `test/check_migration_block_authoring.sh CHANGELOG.md`, plus fixtures in `test/test_migration_block_authoring.sh`. Every runnable migration block must be inside a `## [x.y.z]` release entry, use `${HARNESS_DIR}/bin` rather than `./bin`, avoid forced worktree/branch removal, and leave daemon lifecycle to the operator. | A block is unattributable, invokes `./bin`, force-removes a worktree or branch, or starts/stops/restarts a daemon (including a kill command). Diagnostics name the source line and clause. | Move the block into its release entry; resolve harness binaries through `${HARNESS_DIR}`; remove destructive Git or daemon lifecycle actions and print operator guidance instead. |
| 20 | The `/stories` skill's heading template parses under the engine's own grammar: `splitStoryBlocks` (`src/conductor/src/engine/story-criteria.ts`) still declares `/^##\s+Story\s+([A-Za-z0-9.\-]+)/i`; every `## Story` heading in `skills/stories/SKILL.md` carries an id; and the skill states the id requirement in prose. | The engine regex changes without the template, a template heading omits its id (`## Story: Title`), or the prose requirement is dropped. | Update `skills/stories/SKILL.md` and this check together. An id-less heading does not match, so a stories file collapses into one unnamed block: the per-story happy/negative gate then runs once over the whole file, per-story plan coverage falls back to a filename-derived id, and `story-<id>` coherence citations are rejected as fabricated at land. |

| 21 | Removed wiring-contract residue. `land-spec.ts` no longer calls `validateWiredIntoPlan`; `skills/plan/SKILL.md` contains no `Wired-into` or `validate-wired-into` guidance; and `skills/architecture-review/SKILL.md` cites the BUILD-time wiring-judgement ADR while stating that its SHIP sweep is unchanged. | A retired validator call or authoring reference returns, the architecture-review ADR citation is removed, or the unchanged SHIP sweep statement drifts. | Remove the retired residue. Keep wiring judgement in `build_review` and preserve architecture review's independent SHIP sweep. |

| 22 | Update-flow configuration ownership, plus the fixtures that keep the check honest. `test/check_update_flow_config_ownership.sh` extracts the allowed `conductor` keys from `validateConductorBlock`, then verifies the legacy JSON path appears under `bin/` only in `bin/lib/harness-common.sh`, and that direct keys, accessor-map outputs, and static accessor fields are schema-allowed. `test/test_harness_integrity_update_flow.sh` then drives that checker against disposable copies through its two seams (`HARNESS_INTEGRITY_UPDATE_FLOW_BIN_DIR`, `HARNESS_INTEGRITY_CONDUCTOR_SCHEMA_FILE`), proving it still rejects an injected legacy path, an unknown schema key, and an undeterminable allowlist. The spec calls the checker directly, never this suite, so nothing recurses. | The schema allowlist cannot be determined, the legacy path appears elsewhere under `bin/`, an update-flow key is not in the schema, a scan cannot run, or a fixture case stops failing. Diagnostics identify the offending file and line. | Keep the legacy JSON only as the one-time seed in `bin/lib/harness-common.sh`; route update state through `conductor:` and add any new key to `validateConductorBlock` before using it. If a fixture case stops failing, the guard has degraded — repair the checker, never the fixture. Scans use `grep`, whose exit codes separate "no matches" from "the scan failed"; a scan error fails closed, so an absent scanner can no longer read as a clean tree. |
| 24 | `test/check_build_review_rubric_skill_vocabularies.sh` executes the engine's anchor parser: a probe imports `build-review-domain.ts`, reads the exported `BUILD_REVIEW_FINDING_VOCABULARIES`, and classifies each anchor reference field's grammar by which discriminating specimens `parseBuildReviewFindingAnchor` accepts. Both are compared in both directions against each `skills/build-review-*/SKILL.md` declaration. | A vocabulary member or enforced grammar drifts from the contract in either direction, a field accepts arbitrary input (unenforced), acceptance matches no known grammar, the parser rejects the fully-documented specimen anchor, or the domain source cannot be read or executed. | Update the engine and the matching skill contract in the same change; if the parser grew a new required anchor field, update the probe's specimen anchors together with the contract. |
| 26 | The root `LICENSE` exactly matches the canonical Apache License 2.0 text; `NOTICE` carries project attribution; both package manifests and their lockfiles declare the `Apache-2.0` SPDX identifier; and README plus CONTRIBUTING document the grant. | A legal file is absent or altered, attribution drifts, package metadata disagrees, or the reader/contributor notice disappears. | Restore the canonical `LICENSE`, `NOTICE`, package and lockfile metadata, README license section, and CONTRIBUTING license terms together. |
| 27 | Shipped shell scripts and rendered hook assets contain no shell-expanded data inside direct Python/Node source. | A direct interpreter source word or expanding Python heredoc contains parameter expansion, command substitution, or backticks. | Pass runtime values as quoted argv, stdin, or environment data to fixed interpreter source; use a quoted heredoc delimiter for literal stdin source. |
| 29 | `test/test_harness_integrity_failure_reporting.sh` extracts the integrity suite's marked reporting region and proves a guarded failure is reported, later checks continue, the summary is accurate, raw reporter statuses are rejected, and an unguarded abort names its line and exit status. | The reporting markers are absent, a raw `$?` reaches `assert` or `warn_check`, a guarded fixture fails to continue and summarize, an abort diagnostic is absent, or a deliberately non-errexit failure emits one. | Keep each reporter call supplied with an explicitly captured status. Preserve the reporting-region markers and the `ERR` diagnostic handler; repair the focused fixture rather than weakening its mutation cases. |

Note the ordering: the release-artifact sub-checks run `9a, 9b, 9d, 9e, 9f, 9g, 9c` — `9c` is last,
not third. Four checks carry no number at all.

`AGENT_INSTRUCTIONS.md` (and therefore `CLAUDE.md` and `AGENTS.md`, which symlink to it) spells out only
the first seven checks in detail and names this page as the canonical enumeration.

## Environment-dependent behavior

> **Known limitation.** Check 1b degrades to WARN-skip when `shellcheck` is not on `PATH`, with the line
> `shellcheck not installed — skipping shell static analysis`. The run reports green even though the
> shell static-analysis gate never ran. CI installs the tool explicitly
> in both the `integrity` and `shellcheck` jobs, so it always enforces there. Locally, install it
> (`sudo apt-get install shellcheck`, `brew install shellcheck`) before treating a pass as meaningful.

## Where else the suite runs

| Context | Invocation |
| --- | --- |
| CI | The `integrity` job in `.github/workflows/ci.yml` runs `bash test/test_harness_integrity.sh`. It is skipped when the `changes` job classifies the diff as docs-only. |
| CI (shell only) | The `shellcheck` job runs `bash test/lint_shell.sh` — the same script check 1b calls, so the two enforce one file set at one severity. Also skipped on docs-only diffs. |
| Self-host finish gate | `runIntegritySuite` in `src/conductor/src/engine/self-host/release-gate.ts` runs the same script with a 120-second budget before a PR opens. A missing script, a timeout, or any non-zero exit HALTs the build. See [releases](releases.md). |

Other static checks are separate from this suite: `npm run typecheck`, `npm run typecheck:test`,
`npm run lint`, and `npm test` in `src/conductor`, plus the `links` job's documentation link check.
See [testing](testing.md).
