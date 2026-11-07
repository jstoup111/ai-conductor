# Architecture Review: Enforce canonical code formatting on touched files
**Date:** 2026-11-07
**Mode:** Lightweight (Medium tier) — Technical Feasibility and Architectural Alignment
**Inputs reviewed:** `.docs/track/code-formatting-is-entirely-unenforced-no-formatte.md` (technical track, operator-confirmed scope boundary), `.docs/complexity/code-formatting-is-entirely-unenforced-no-formatte.md`, `.docs/architecture/code-formatting-is-entirely-unenforced-no-formatte.md` (operator-approved 2026-11-07), intake jstoup111/ai-conductor#1991
**Verdict:** APPROVED WITH CONDITIONS
**Operator approval:** Decisions 1–7 approved by operator 2026-11-07

## Decisions

1. **Formatter.** Prettier formats both TypeScript and shell; shell formatting is supplied by `prettier-plugin-sh`, which embeds the mvdan/sh formatter as WebAssembly (`sh-syntax`). Both are `devDependencies` of `src/conductor/package.json` pinned to exact versions (no range operator), so the canonical form changes only through a deliberate version bump. Biome plus a system `shfmt` binary is rejected: `shfmt` is not installed on the self-host machine, so the self-host `test_suite` would gain a system prerequisite, while Prettier with the plugin is delivered entirely by the existing `npm ci`.
2. **Canonical style.** Line width 120, two-space indentation, single quotes, semicolons, LF line endings, matching the codebase's dominant existing style. Prettier option values live in one configuration file at the repository root (`.prettierrc.json`), beside a root `.prettierignore`; both sit at the root because Prettier resolves ignore patterns relative to the ignore file's own directory (verified 2026-11-07: a `src/conductor/.prettierignore` pattern `/test/fixtures/` does not ignore `<root>/test/fixtures/a.ts`, while the same pattern in a root ignore file does). The root configuration names no plugin, because a root plugin reference cannot resolve without a root `node_modules`; the format script supplies `prettier-plugin-sh` explicitly. `.editorconfig` mirrors indentation, line endings, and final newline for editors; the Prettier configuration is authoritative where they could disagree. Shell output keeps redirects unspaced (`spaceRedirects: false`), matching the existing scripts (140 `2>/dev/null`, 0 `2> /dev/null`).
3. **File set.** The checked set is TypeScript (`*.ts`, `*.mts`) under `src/conductor/` and `plugins/`, plus shell scripts: tracked `*.sh` files and tracked extensionless files whose first line is a `sh` or `bash` shebang. Fixture, generated, and dependency paths (`src/conductor/test/fixtures/`, `src/conductor/test/types/fixtures/`, `test/fixtures/`, `examples/fixtures/`, `node_modules/`, `src/conductor/dist*/`) are excluded through the root ignore file, which also lists the out-of-scope Markdown, JSON, and YAML types so an editor running Prettier skips them. Deleted files are never checked.
4. **Changed-file resolution.** One script resolves the file set as files added, copied, modified, or renamed between a base reference and the working tree, intersected with the checked set. The base is an explicit `--base <ref>` argument when supplied, otherwise the merge-base of `HEAD` with `origin/main`. When no base can be resolved the check fails non-zero and names the missing reference; it never passes on an empty set it could not compute.
5. **Commands.** `npm run format:check` (read-only, fails when any resolved file is not in canonical form, listing each) and `npm run format` (writes canonical form to the resolved files). `npm run format -- --all` formats every file in the checked set regardless of base, for the operator's manual sweep. Check and write use the same script, configuration, and pinned versions, so a file `format` writes passes `format:check`.
6. **Enforcement points.** A `format` job in `.github/workflows/ci.yml` runs `format:check` with `--base` set to the pull request base SHA, follows the existing `changes` / `docs_only` gating, and is added to the `ci-gate` job's `needs` list and result summary. The self-host `test_suite` in `.ai-conductor/config.yml` runs `format:check` beside the existing typecheck entry in both `commands` and `changed_command`, so a self-host build fails before a pull request exists.
7. **Untouched surfaces.** `src/conductor/eslint.config.mjs` gains no rule, `hooks/claude/lint-after-edit.sh` and every other consumer-shipped file are unchanged, and no whole-repository reformat commit is part of this change.

## Feasibility

| Item | Assessment | Basis |
|---|---|---|
| Prettier formats the TypeScript trees | Feasible. A whole-tree dry run of Prettier 3.9.10 over 2,562 files completed without parse errors. | verified (scratch run 2026-11-07) |
| `prettier-plugin-sh` formats the shell scripts | Feasible. Version 0.20.2 formatted all 103 tracked `*.sh` files with 0 errors in 2.1s, and every rewritten file passes `bash -n`. An extensionless bash file (`bin/migrate`) is recognized by shebang. | verified (scratch run 2026-11-07) |
| Extensionless shell scripts exist | 12 tracked files, including `bin/install`, `bin/migrate`, `bin/setup`, and `skills/intake/scripts/intake-file`. | verified (`git ls-files` plus shebang scan) |
| No new runtime, service, or system prerequisite | Both packages install through the existing `npm ci` in `src/conductor`; `plugins/*` already share the engine's tool installs for lint. | verified (`ci.yml` lint and typecheck jobs) |
| Base reference availability | CI checks out with `fetch-depth: 0` in the `changes` job pattern and has `github.event.pull_request.base.sha`. The self-host `changed_command` already depends on a merge-base with `origin/<default>` (`{base}`). | verified (`ci.yml`, `.ai-conductor/config.yml`) |
| Changed-file cost | Formatting is limited to changed files, so typical runs touch tens of files; the whole set formats in seconds. | inferred (whole-tree dry run timing) |

## Alignment

- **Repository scope.** Every change is harness-repository-only per `.agents/skills/scope-check`: it touches this repository's CI (`.github/workflows/`), its `.ai-conductor/config.yml` custom steps, and its conductor package scripts. No consumer-shipped surface changes, so no `HARNESS.md` or `skills/` change follows.
- **Machinery over prompt discipline.** Canonical form is computed and enforced mechanically at the point of violation; no skill, persona, or review rubric gains a formatting rule. A grep of `skills/`, `agents/`, `HARNESS.md`, and `AGENT_INSTRUCTIONS.md` found no existing formatting rule to retire.
- **Errors-only ESLint stance.** Preserved: the formatter is a separate tool and `eslint.config.mjs` is unchanged, consistent with its in-file policy.
- **Gate pattern consistency.** The CI job mirrors the existing `typecheck` job shape (`needs: changes`, docs-only skip, `setup-node` with the conductor lockfile, `npm ci`), and joins `ci-gate` like every other required job. The `test_suite` entry mirrors the typecheck entry added by #3429. Structural CI-wiring tests already exist for other jobs (for example `src/conductor/test/structural/shell-tests-ci-wiring.test.ts`), and the new job follows that precedent.
- **Event spine.** No observation or coordination channel is added; the check reports through command exit status and stdout like the existing gates.
- **Production DI defaults, state, security.** Not applicable: no runtime component, state, or input boundary is introduced.
- **Worktree isolation.** The check reads only its own worktree and git refs; no shared port, file, or service.

## Domain Integrity

Skipped in lightweight mode; no domain model is introduced.

## Wiring Surface

| New surface | Production caller |
|---|---|
| Changed-file format script under `src/conductor/scripts/` | Invoked by the `format` and `format:check` scripts in `src/conductor/package.json` |
| `format:check` package script | The new `format` job in `.github/workflows/ci.yml`; the self-host `test_suite.commands` and `test_suite.changed_command` in `.ai-conductor/config.yml` |
| `format` package script (changed and `--all` modes) | Operator and agent command line; no automated caller writes files |
| Prettier configuration and ignore file at the repository root | Read by Prettier through the format script |
| `.editorconfig` at the repository root | Read by editors; no harness caller |
| `format` CI job | Listed in the `ci-gate` job's `needs` and result summary |

Advisory overlap scan over these paths: `.ai-conductor/config.yml` overlaps `spec/test-suite-skips-typecheck-test-so-test-type-error`, whose implementation already shipped to `main` as #3429 (`03014f1065`); no in-flight overlap.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A touched file's first edit carries a whole-file reformat hunk in that feature's diff | Technical | High | Medium | Operator-accepted scope trade-off; the operator's whole-repository `--all` sweep at an empty queue ends it. |
| Reformatting a touched file breaks a test that reads source text (9 test files read source with `readFileSync`) or a byte-compared fixture | Technical | Medium | Medium | Byte-compared fixtures and goldens are excluded through the ignore file (Decision 3); a reformat that breaks a source-reading test fails the same build's `test_suite`. |
| An unpinned formatter upgrade changes canonical form and fails unrelated pull requests | Technical | Low | Medium | Exact version pins (Decision 1); a bump is its own change. |
| The base reference is stale or missing in a self-host worktree, so the changed set is wrong | Integration | Low | Medium | Same `origin/main` merge-base the existing `changed_command` already uses; an unresolvable base fails closed (Decision 4). |
| Builds in flight when this merges fail `test_suite` on files they touched | Integration | Medium | Low | The failure names the files and `npm run format` is the fix; no rebase machinery is in scope. |

## ADRs Created

None. The structural prerequisite in this skill is not met: the change adds a developer-tooling dependency and a merge gate, and establishes no system boundary, component decomposition, integration pattern, state architecture, or runtime/framework technology. No APPROVED ADR governs code formatting or development tooling choice. The decisions above are recorded in this review and are binding on the plan.

## Assumptions

| Assumption | Basis | Impact if wrong | Confirmation | Approval |
|---|---|---|---|---|
| Prettier 3.9.10 with `prettier-plugin-sh` 0.20.2 parses every in-scope file | verified | Formatter cannot run on some files | Scratch runs over 2,562 TypeScript and 103 shell files, 0 parse errors | — |
| Width 120 is the canonical line width | inferred | A different width changes every touched file's reformat | Operator approval of Decision 2 | APPROVED by operator 2026-11-07 |
| `origin/main` is present in self-host worktrees at `test_suite` time | inferred | Check fails closed on every self-host build | The existing `changed_command` `{base}` already depends on it | APPROVED by operator 2026-11-07 |

## Conditions

1. The plan pins `prettier` and `prettier-plugin-sh` to exact versions and commits the lockfile change.
2. The plan includes a structural test asserting the `format` CI job exists, runs `format:check` with the pull request base, and appears in `ci-gate`'s `needs`, following the existing CI-wiring test precedent.
3. The check fails closed, with a named error, when no base reference resolves; a test proves it.
4. No task reformats files outside those the change itself touches.
