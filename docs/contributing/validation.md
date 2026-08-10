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

Run it from the repository root, before every commit. It takes no arguments.

Two result classes:

- `assert` failures print `FAIL`, increment the failure count, and make the script exit 1.
- `warn_check` failures print `WARN` and are counted separately. They **never** change the exit code.

The summary line reports `N passed  N failed  N warnings  (N total)`. Only the failure count matters for
exit status.

Install engine dependencies first, or three checks silently degrade:

```bash
cd src/conductor && npm ci
```

Without `src/conductor/node_modules`, checks 5a, 5b, and 5c WARN-skip with these exact lines, and you
lose local coverage that CI still enforces:

```text
src/conductor/node_modules absent — skipping model-table drift check
model-table checks skipped — run npm install in src/conductor
src/conductor/node_modules absent — skipping docs-guard hook drift check
```

Check 5b additionally needs `jq` on `PATH`; without it you get
`model-table pin check skipped — jq not installed`.

## The checks

In file order. Sections 1, 5, and 9 carry lettered sub-checks, and four checks are unnumbered in the script.

| # | Verifies | Fails when | Fix |
| --- | --- | --- | --- |
| — | The repository root has no `package-lock.json`. The Node project lives under `src/conductor/`; a root lockfile would describe no installable package and mislead dependency tooling about that boundary. | `package-lock.json` exists at the repository root. | Remove the stray root lockfile; run `npm ci` inside `src/conductor/` instead. |
| 1 | `bash -n` over `bin/*` (only files whose first line matches `bash`), `hooks/claude/*.sh`, `test/*.sh`, and `.github/scripts/*.sh`. | Any of those scripts has a syntax error. | Fix the syntax. A `bin/` file with a non-bash shebang is skipped entirely, not checked. |
| 1b | ShellCheck at `--severity=error` over the script set enumerated by `test/lint_shell.sh` (`bin/*` by shebang, plus `hooks/**/*.sh`, `test/*.sh`, `.github/scripts/*.sh`). Where check 1 proves a script *parses*, this catches shell bugs that parse fine and misbehave at runtime. | Any finding at `error` severity (exit 1), or the enumeration returns zero scripts (exit 2 — the gate refuses to report success on an empty set). | Run `test/lint_shell.sh` and fix what it names. Threshold and deferred warning/info/style counts are documented in that script's header. |
| 2 | Every `skills/*/SKILL.md` opens with `---` and its frontmatter contains `name:`, `description:`, `enforcement:`, `phase:`. | The delimiter or any required field is missing. | Add the field. See [skills](../reference/skills.md). |
| 3 | Every `agents/[a-z_-]*.md` string appearing in `skills/` or `HARNESS.md` exists on disk. | A referenced agent file is missing. | Create the agent file or fix the reference. |
| 4 | Every backticked `` `/name` `` reference in `skills/*/SKILL.md` maps to a `skills/<name>/` directory. | Never — this is a `warn_check`. | Rename the reference, or accept the WARN for genuine slash commands like `/quit`. |
| 5 | Every `skills/*/` directory name matches `\| <name>[ (\|]` somewhere in `HARNESS.md`. | Never — this is a `warn_check`. | Add a model-table row and regenerate. |
| 5a | `bin/generate-model-table --check` reports no drift between the generated HARNESS.md table region and `model-table-metadata.ts` + `resolved-config.ts`. Plus a fixture sub-test that corrupts a temp copy's Codex provider label and requires exit 1 *and* a unified diff naming both the changed and the canonical header line. | Exit 1 (drift), exit 2 (environment error), or any other non-zero exit. The fixture fails if `--check` cannot produce a useful diff. | Run `bin/generate-model-table` and commit the rewritten HARNESS.md region. Never hand-edit rows between the `BEGIN GENERATED: model-selection-table` and `END GENERATED` markers. |
| 5b | For every `skills/*/SKILL.md` carrying a `model:` frontmatter line, the pin equals `.expected` from `bin/generate-model-table --pins`. Entries with `.exempt == true` pass without comparison. | The pin disagrees with expected; a pinned skill is absent from `--pins` (reported as "unmapped"); or `--pins` emits unparseable JSON. | Fix the pin, or map the skill in `SKILL_STEP_MAP` / exempt it in `PIN_EXEMPT_SKILLS` (`src/conductor/src/engine/model-table-metadata.ts`). |
| 5c | `bin/generate-docs-guard-hook --check` reports no drift between the committed `hooks/claude/docs-guard.sh` and `src/conductor/src/engine/session-hook-assets.ts`. Plus a fixture sub-test that appends a corrupting comment to the hook and requires exit 1. | Exit 1, 2, or any other non-zero exit; or the corrupted fixture is not detected. | Edit the TypeScript source, run `bin/generate-docs-guard-hook`, commit the regenerated `.sh`. Never hand-edit the hook. |
| 6 | Every `templates/[a-z_.-]*.template` string in `skills/` or `HARNESS.md` exists on disk. | A referenced template is missing. | Create it or fix the reference. |
| 7 | Per SKILL.md, no two `### <n>` headings share an identifier. Sub-markers are kept, so `### 2.` and `### 2.5` — or `### 3.` and `### 3a.` — do not collide. | Two headings resolve to the same identifier. | Renumber. |
| 8 | Zero matches for `embed(`, `cosineSimilarity`, `vectorSearch`, `relevanceScore`, or `rankScore` across `src/conductor/src`, `bin`, `hooks`, and `skills`, excluding any `engineer` directory. | Any harness-side embedding, vector-search, or relevance/rank-scoring logic exists for the memory subsystem. | Remove it. Recall is performed by the LLM reading the store, not by harness-side retrieval. |
| 9a | `VERSION` exists and matches `^[0-9]+\.[0-9]+\.[0-9]+$`. | Missing or malformed. | Fix `VERSION`. See [releases](releases.md). |
| 9b | `CHANGELOG.md` exists and contains a line matching `^## \[Unreleased\]`. | The file or the header is absent. Content may be empty. | Restore the header. |
| 9d | `skills/pipeline/SKILL.md` contains, case-insensitively, `user-requested exit during a run` **and** the literal `halt-user-input-required`. | Either string is gone. | Restore the contract text and keep the marker name in sync with `engine/artifacts.ts`. Without it, the build gate cannot distinguish a clean pipeline exit from an operator-requested halt. |
| 9e | `skills/stories/SKILL.md` matches `Status[^A-Za-z]*Accepted`. | The token is missing. | Restore the `Status: Accepted` instruction. The engineer land gate and the daemon backlog both require it; a stories file without it is skipped forever, silently. |
| 9f | `templates/adr.md.template`'s `**Status:**` line offers only pipe-delimited values whose leading word (uppercased) is `APPROVED` or `SUPERSEDED` — a terminal annotation like `SUPERSEDED by <slug>` stays valid. | Any offered status normalizes to something else, e.g. `Proposed` or `Accepted`. | Restore the template to offer only `APPROVED \| SUPERSEDED by {{superseding-adr-slug}}`. An offered value the `adrApprovalStatus` parser rejects would fail every new ADR at land and at daemon discovery. |
| 9g | `skills/architecture-review/SKILL.md` contains all four of `conduct-ts overlap-scan`, `Wiring Surface`, `advisory` (any case), and `/plan`. | Any one is missing. | Restore all four. |
| 9c | Every `git tag -l 'v*.*.*'` has a matching `^## \[<version>\]` section in `CHANGELOG.md`. Runs only when `.git` is a directory and `CHANGELOG.md` exists. | A released tag has no changelog section. | Add the section. |
| 10 | No write to `.pipeline/task-status.json` outside the engine. Greps `task-status` in `hooks/` and `bin/` (`*.sh`, `*.ts`, `*.js`), drops comment/console/log/`readFile` lines and quoted literals, then flags anything matching `writeFile`, `.write`, `fs.write`, `fs.appendFile`, `>>`, or `>`. | A non-engine writer is found. | Route the write through `src/conductor/src/engine/`. The engine is the sole authority on task-completion state. |
| — | `skills/pipeline/SKILL.md` does **not** match `(^\|[^\`])Run \`conduct-ts task (start\|done)`. | Imperative per-task CLI stamping text is present. | Rewrite descriptively — the skill documents session-hook machinery, not an imperative step. Mentions of the CLI as operator or recovery machinery are fine. |
| — | `skills/pipeline/SKILL.md` still states the batch-boundary evaluator closeout-event gate as a full semantic contract, exercised against fixtures that each corrupt one clause: the required `pipeline_closeout` obligation match text, the "an event for another obligation does not satisfy this check" clause, the independent `review.json` hard-gate clause, the exact `Batch N blocked: missing recorded closeout event for evaluator` halt message, and the two "cannot cure" non-substitutability clauses. | Any corrupted-fixture case still reads as passing (the predicate degraded into a keyword-presence check), or the real file fails one of the seven clauses. | Restore the exact clause the diagnostic names in `skills/pipeline/SKILL.md`; keep both the `review.json` gate and the evaluator closeout-event gate independently stated so neither can cure the other. |
| 11 | Every `.github/ISSUE_TEMPLATE/*.yml` and `*.yaml` parses as YAML, and `config.yml`'s `blank_issues_enabled` is not `false`. Parses with python3 + pyyaml, falling back to node + js-yaml; WARN-skips when neither is available. | A template is invalid YAML, or `blank_issues_enabled: false` is set. | Fix the YAML. Leave `blank_issues_enabled` unset or true. |
| — | Every `.docs/intake/*.md` matches `^Owner:[[:space:]]*[^[:space:]]+`. | A hand-authored intake doc lacks an `Owner:` line. | Stamp `Owner:`. Authoring normally does this at write time; this is a belt on hand-written docs. |
| 12 | `skills/plan/SKILL.md` contains `conduct-ts overlap-scan` and, case-insensitively, `advisory`. | Either is missing. | Restore the overlap-scan step and its advisory wording. |
| 13 | `bash test/test_ci_detect_docs_only.sh` exits 0. | The docs-only CI predicate in `.github/scripts/ci-detect-docs-only.sh` regressed. | Fix the predicate; the failing assertions are printed inline. |
| 14 | `bash test/test_provider_skill_contracts.sh` exits 0. | An unscoped Claude-specific command, model, tool, delegation, or interaction — or a weakened shared gate — was reintroduced into a canonical skill. | Rescope the skill text so both hosts can load it. See [multiprovider](../guides/multiprovider.md). |
| 15 | `AGENT_INSTRUCTIONS.md` is a regular file, and both `CLAUDE.md` and `AGENTS.md` are symlinks whose `readlink` is exactly `AGENT_INSTRUCTIONS.md`. | Either symlink is missing, replaced by a regular file, or retargeted. | `ln -sf AGENT_INSTRUCTIONS.md CLAUDE.md` and `ln -sf AGENT_INSTRUCTIONS.md AGENTS.md`. |
| 16 | `test/check_halt_writers.sh` — a lexical scan of `src/conductor/src` for production code that writes `.pipeline/HALT` (directly, via a local alias, or across a multiline call) outside `engine/halt-marker.ts`, plus its own fixture suite covering constant, multiline, alias-variable, and literal-path violations. | The script exits non-zero: a real violation is found, or a fixture the scanner is supposed to catch is missed. | Route the write through `writeHaltMarker` in `src/conductor/src/engine/halt-marker.ts` instead of writing the file directly. |
| 17 | `test/test_docs_navigation.sh --site-contract` (fixture and real-tree hosted-documentation navigation contracts) and `test/test_docs_pages_smoke.sh` (deterministic Pages adapter contracts, `gh` and `curl` replaced at the process boundary). | Either script exits non-zero, or either script is missing. | Fix the reported navigation or adapter contract violation. The real Pages HTTP probe is a separate opt-in smoke test, never run from integrity. |
| 19 | `test/check_migration_block_authoring.sh CHANGELOG.md`, plus fixtures in `test/test_migration_block_authoring.sh`. Every runnable migration block must be inside a `## [x.y.z]` release entry, use `${HARNESS_DIR}/bin` rather than `./bin`, avoid forced worktree/branch removal, and leave daemon lifecycle to the operator. | A block is unattributable, invokes `./bin`, force-removes a worktree or branch, or starts/stops/restarts a daemon (including a kill command). Diagnostics name the source line and clause. | Move the block into its release entry; resolve harness binaries through `${HARNESS_DIR}`; remove destructive Git or daemon lifecycle actions and print operator guidance instead. |
| 20 | The `/stories` skill's heading template parses under the engine's own grammar: `splitStoryBlocks` (`src/conductor/src/engine/artifacts.ts`) still declares `/^##\s+Story\s+([A-Za-z0-9.\-]+)/i`; every `## Story` heading in `skills/stories/SKILL.md` carries an id; and the skill states the id requirement in prose. | The engine regex changes without the template, a template heading omits its id (`## Story: Title`), or the prose requirement is dropped. | Update `skills/stories/SKILL.md` and this check together. An id-less heading does not match, so a stories file collapses into one unnamed block: the per-story happy/negative gate then runs once over the whole file, per-story plan coverage falls back to a filename-derived id, and `story-<id>` coherence citations are rejected as fabricated at land. |

| 21 | The two halves of the `Wired-into:` contract still agree. `landSpec` (`src/conductor/src/engine/engineer/land-spec.ts`) still calls `validateWiredIntoPlan` — the blocking, every-tier, deterministic anchor gate. And `skills/plan/SKILL.md` §5c's judged pass still states that the anchors already resolve before judging, still forbids running the judged pass during BUILD, and still forbids downgrading a judged finding to a `none (...)` waiver. | The engine gate is unwired, or any of the three §5c clauses is dropped. | Re-wire the gate, or restore the §5c clause the diagnostic names — together, never one without the other. If the gate goes, §5c's "these already resolve" premise is false and the judged pass silently begins re-litigating resolvability from prose. If the DECIDE-only clause goes, the judged pass can instruct a mid-build plan rewrite, which reproduces [#1399](https://github.com/jstoup111/ai-conductor/issues/1399): `build_review` reports the compliance as an unauthorized scope violation and the remediation re-triggers the gate, a loop that costs a needs-human HALT. If the no-downgrade clause goes, an author can convert a real wiring defect into a waiver form the deterministic gate `SKIP`s without inspection. |
| 22 | Update-flow configuration ownership, plus the fixtures that keep the check honest. `test/check_update_flow_config_ownership.sh` extracts the allowed `conductor` keys from `validateConductorBlock`, then verifies the legacy JSON path appears under `bin/` only in `bin/lib/harness-common.sh`, and that direct keys, accessor-map outputs, and static accessor fields are schema-allowed. `test/test_harness_integrity_update_flow.sh` then drives that checker against disposable copies through its two seams (`HARNESS_INTEGRITY_UPDATE_FLOW_BIN_DIR`, `HARNESS_INTEGRITY_CONDUCTOR_SCHEMA_FILE`), proving it still rejects an injected legacy path, an unknown schema key, and an undeterminable allowlist. The spec calls the checker directly, never this suite, so nothing recurses. | The schema allowlist cannot be determined, the legacy path appears elsewhere under `bin/`, an update-flow key is not in the schema, a scan cannot run, or a fixture case stops failing. Diagnostics identify the offending file and line. | Keep the legacy JSON only as the one-time seed in `bin/lib/harness-common.sh`; route update state through `conductor:` and add any new key to `validateConductorBlock` before using it. If a fixture case stops failing, the guard has degraded — repair the checker, never the fixture. Scans use `grep`, whose exit codes separate "no matches" from "the scan failed"; a scan error fails closed, so an absent scanner can no longer read as a clean tree. |

Note the ordering: the release-artifact sub-checks run `9a, 9b, 9d, 9e, 9f, 9g, 9c` — `9c` is last,
not third. Four checks carry no number at all.

`AGENT_INSTRUCTIONS.md` (and therefore `CLAUDE.md` and `AGENTS.md`, which symlink to it) spells out only
the first seven checks in detail and names this page as the canonical enumeration.

## Checks that cannot fail

> **Known limitation.** Checks 4 and 5 use `warn_check`, so neither can ever fail the suite or change its
> exit code — they are reported as validation in prose but implemented as advisory. Check 5 has a
> permanent WARN that no edit will clear: the `tdd` skill directory has no model-table row of its own
> because `HARNESS.md:186-187` lists `tdd-red` and `tdd-green`, and the check's regex `\| tdd[ (|]` does
> not match `| tdd-red`. Expect `tdd — not in HARNESS.md model selection table` in every run.
> Tracked in [#1014](https://github.com/jstoup111/ai-conductor/issues/1014).

> **Known limitation.** Check 5b enforces one direction only. `AGENT_INSTRUCTIONS.md` describes it as
> "Every skill marked opus-tier in the model table pins `model: opus` in its SKILL.md frontmatter, and
> vice versa", but the implementation skips any skill with no `model:` line (`if [ -z "$pinned" ]; then
> continue; fi`). A skill the table marks opus-tier while its SKILL.md carries no pin passes silently —
> only the pin-to-expected direction is enforced, never expected-to-pin. Tracked in
> [#1014](https://github.com/jstoup111/ai-conductor/issues/1014).

> **Known limitation.** Check 10's own comments say the audit covers "hooks, skills, or bin/" and would
> go red on unauthorized writers in `hooks/`, `skills/`, or `bin/`. The grep covers only
> `${HARNESS_DIR}/hooks` and `${HARNESS_DIR}/bin` — `skills/` is never scanned. A skill that instructs an
> agent to write `.pipeline/task-status.json` will not be caught here. Tracked in
> [#1014](https://github.com/jstoup111/ai-conductor/issues/1014).

## Environment-dependent behavior

> **Known limitation.** Checks 5a, 5b, and 5c degrade to WARN-skip when `src/conductor/node_modules` is
> absent, and 5b also skips when `jq` is missing. In a fresh clone the run reports green while three
> generated-artifact drift gates never executed — and CI, which runs `npm ci` first, will catch the drift
> you did not. Run `cd src/conductor && npm ci` before treating a local integrity pass as meaningful.
> Tracked in [#1014](https://github.com/jstoup111/ai-conductor/issues/1014).

> **Known limitation.** Check 1b degrades to WARN-skip when `shellcheck` is not on `PATH`, with the line
> `shellcheck not installed — skipping shell static analysis`. Same shape as the 5a/5b/5c gap above: the
> run reports green while the shell static-analysis gate never executed. CI installs the tool explicitly
> in both the `integrity` and `shellcheck` jobs, so it always enforces there. Locally, install it
> (`sudo apt-get install shellcheck`, `brew install shellcheck`) before treating a pass as meaningful.

> **Known limitation.** Check 5c mutates a tracked file during the run. It backs up
> `hooks/claude/docs-guard.sh` to a temp file, appends
> `# deliberately corrupted for drift-detection fixture test` to the committed path in place, runs
> `--check` expecting exit 1, then restores byte-for-byte — via a `trap` so a failed assertion still
> restores. If the process is hard-killed mid-check, your working tree is left with a corrupted committed
> hook. Recover with `git checkout -- hooks/claude/docs-guard.sh`. Tracked in
> [#1014](https://github.com/jstoup111/ai-conductor/issues/1014).

## Where else the suite runs

| Context | Invocation |
| --- | --- |
| CI | The `integrity` job in `.github/workflows/ci.yml` runs `bash test/test_harness_integrity.sh`. It is skipped when the `changes` job classifies the diff as docs-only. |
| CI (shell only) | The `shellcheck` job runs `bash test/lint_shell.sh` — the same script check 1b calls, so the two enforce one file set at one severity. Also skipped on docs-only diffs. |
| Self-host finish gate | `runIntegritySuite` in `src/conductor/src/engine/self-host/release-gate.ts` runs the same script with a 120-second budget before a PR opens. A missing script, a timeout, or any non-zero exit HALTs the build. See [releases](releases.md). |

Other static checks are separate from this suite: `npm run typecheck`, `npm run typecheck:test`,
`npm run lint`, and `npm test` in `src/conductor`, plus the `links` job's documentation link check.
See [testing](testing.md).
