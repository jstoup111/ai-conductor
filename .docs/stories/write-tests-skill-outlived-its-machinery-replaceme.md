**Status:** Accepted

# Stories: write-tests carries only judgment and is reachable from every host (#1389)

Technical track; no PRD. Acceptance criteria derive from issue #1389's desired outcomes and the
operator-confirmed Balanced scope in `.docs/track/write-tests-skill-outlived-its-machinery-replaceme.md`.
"The skill" means `.agents/skills/write-tests/SKILL.md`. "The wiring checker" means the new
repository-integrity check for the local skill catalog. A "fixture root" is a temporary copy of the
repository's `.agents/skills/` and `.claude/skills/` trees, never the live checkout.

## Story 1: The write-tests skill keeps its judgment rules and drops what machinery or HARNESS.md owns

As an agent authoring tests in this repository, I want the write-tests skill to carry only the
test-design judgment no gate makes for me, and to point at the machinery that backs the rest, so that
I follow binding rules without being told to do work a gate already does or that `HARNESS.md` forbids.

### Acceptance Criteria

#### Happy Path
- Given the skill, when an agent reads its CI-parity guidance, then it names the CI `typecheck:test` and `lint` jobs in `.github/workflows/ci.yml` as the gate that proves test files type-check and lint, and it no longer instructs the agent to find or choose a typecheck target that covers the test directory.
- Given the skill, when an agent reads its mechanized-backstops section, then that section names `AI_CONDUCTOR_NO_REAL_EXEC` in `src/conductor/test/setup.ts` as the partial backstop for the external-boundary rules, the suite leak guards (tmpdir, pipeline, signals, park, and tmux) as the partial backstop for the cleanup rules, and the `vitest.config.ts` smoke and e2e exclusion as the backstop for smoke placement, and states that each backstop is partial so the rule it backs remains binding.
- Given the skill, when an agent reads it, then the rules for classifying the test level, selecting the seam before writing the fixture, bounding every Conductor fixture, mocking external boundaries through dependency injection, keeping time deterministic, keeping cleanup trustworthy, avoiding false integration tests, placing live-corpus tests in `src/conductor/test/corpus/`, and diagnosing a slow or wedged suite (isolate, inspect, fix, re-run together) are all still present.

#### Negative Paths
- Given the skill, when it is searched for an instruction to run the configured aggregate test command before handoff, as a diagnosis step, or as a completion-checklist item, then none is found, and the skill instead states that the `test_suite` gate owns aggregate runs as `HARNESS.md` defines.
- Given the trimmed skill, when `test/check_skill_invocation_policy.sh` runs against the live repository, then it still passes, because the skill keeps its `name: write-tests` and canonical `disable-model-invocation: true` frontmatter and its `agents/openai.yaml` keeps `allow_implicit_invocation: false`.

### Done When
- [ ] The skill contains the strings `typecheck:test` and `test_suite`, and contains neither `Before handoff, run` nor `Run the project's aggregate test command once`.
- [ ] The skill has a mechanized-backstops section containing `AI_CONDUCTOR_NO_REAL_EXEC`, `leak guard`, and `vitest.config.ts`.
- [ ] `test/check_skill_invocation_policy.sh <repo-root>` exits 0 on the delivered tree.

## Story 2: Every repository-local skill is discoverable from both hosts, or the integrity suite fails

As a maintainer of this repository, I want each skill under `.agents/skills/` to be reachable from
Claude through a committed `.claude/skills/` symlink, with the integrity suite rejecting any skill
wired for only one host, so that test-authoring and other local guidance never applies on one
provider and silently not on the other.

### Acceptance Criteria

#### Happy Path
- Given the delivered tree, when `.claude/skills/write-tests` is inspected, then it is a committed git symlink (mode `120000`) whose target is `../../.agents/skills/write-tests` and which resolves to the same `SKILL.md` Codex reads.
- Given the live repository where every `.agents/skills/<name>/` has a `.claude/skills/<name>` symlink resolving to it and every `.claude/skills/<name>` entry has a matching `.agents/skills/<name>/`, when `test/test_harness_integrity.sh` runs, then its local-skill host-wiring assertion passes and its wiring-checker mutation-suite assertion passes.
- Given `.agents/skills/scope-check/SKILL.md`, when an agent reads its local catalog's current-members row and its already-mechanized list, then the row defines the members as every directory under `.agents/skills/` instead of a hand-maintained name list, and the mechanized list names the wiring checker as the enforcement for the `.claude/skills/<name>` symlink and `test/check_skill_invocation_policy.sh` as the enforcement for `agents/openai.yaml`.

#### Negative Paths
- Given a fixture root where `.agents/skills/<name>/` exists with no `.claude/skills/<name>` entry, when the wiring checker runs against it, then it exits non-zero and its output names `<name>` as missing its `.claude/skills` symlink.
- Given a fixture root where `.claude/skills/<name>` is a dangling symlink or a symlink that resolves outside `.agents/skills/<name>`, when the wiring checker runs against it, then it exits non-zero and its output names `<name>` and the unexpected target.
- Given a fixture root where `.claude/skills/<name>` exists with no matching `.agents/skills/<name>/`, when the wiring checker runs against it, then it exits non-zero and its output names `<name>` as an orphaned `.claude/skills` entry.
- Given a fixture root where `.claude/skills/<name>` is a regular directory copy of the skill rather than a symlink, when the wiring checker runs against it, then it exits non-zero and its output names `<name>` as not a symlink.
- Given a fixture root whose `.agents/skills/` contains no skill directories, when the wiring checker runs against it, then it exits non-zero reporting that it enumerated no local skills, rather than passing on an empty set.

### Done When
- [ ] `git ls-files -s .claude/skills/write-tests` reports mode `120000`, and `readlink .claude/skills/write-tests` prints `../../.agents/skills/write-tests`.
- [ ] The wiring checker exits 0 against the delivered repository root.
- [ ] The wiring checker's mutation suite passes, asserting a non-zero exit and the named diagnostic for each of the five negative fixtures above.
- [ ] `test/test_harness_integrity.sh` reports both new assertions, and `test/shell_tests.manifest` classifies both new scripts so `test/check_shell_test_classification.sh` passes.
