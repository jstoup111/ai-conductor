**Status:** Accepted

# Stories: Skill frontmatter agrees with the engine (#1018)

Track: technical. Source of truth: the engine's built-in step definitions (`ALL_STEPS` plus the
non-default steps such as `assess`, `remediate`, `attribution_verify`). A "step-mapped skill" is a
skill directory named by at least one built-in step definition's `skillName`.

## Story 1: Step-mapped skills declare the engine's enforcement level

As an operator or agent reading a skill's frontmatter, I want its `enforcement:` value to match the
level the engine actually applies to that skill's step so that I never mistake an advisory step for
a gate (or the reverse).

### Acceptance Criteria

#### Happy Path
- Given the built-in step definitions, when `skills/memory/SKILL.md`, `skills/architecture-diagram/SKILL.md`, `skills/assess/SKILL.md`, and `skills/remediate/SKILL.md` are read, then each declares `enforcement: advisory`, matching its step's engine enforcement.
- Given `architecture-review` backs both `architecture_review` (advisory) and `architecture_review_as_built` (gating), when `skills/architecture-review/SKILL.md` is read, then it declares `enforcement: gating`, the strictest level among the steps it backs.

#### Negative Paths
- Given a step-mapped skill whose step is `gating` in the engine, when its frontmatter is read after this change, then it still declares `enforcement: gating` (no step-mapped skill is weakened below its engine level; e.g. `stories`, `plan`, `finish`, `prd-audit` remain `gating`, and `pipeline` remains `structural`).

### Done When
- [ ] `memory`, `architecture-diagram`, `assess`, and `remediate` SKILL.md frontmatter each read `enforcement: advisory`.
- [ ] `architecture-review` SKILL.md frontmatter reads `enforcement: gating`.
- [ ] No engine step definition's `enforcement` value is changed by this feature.

## Story 2: manual-test's declared dependencies match execution order

As an agent reading `manual-test`'s frontmatter, I want its declared dependencies and usage text to
describe the order the engine runs so that I never wait for `finish` before manual testing.

### Acceptance Criteria

#### Happy Path
- Given the engine runs `manual_test` before `finish`, when `skills/manual-test/SKILL.md` frontmatter is read, then `requires:` does not list `finish` and still lists `verify-claims`.
- Given the same ordering, when the manual-test `description:` is read, then it does not instruct use "after /finish".

#### Negative Paths
- Given any step-mapped skill A whose `requires:` names another step-mapped skill B, when B's earliest step runs strictly after A's latest step in engine order, then the drift check (Story 5) fails naming A, B, and the inverted ordering.

### Done When
- [ ] `skills/manual-test/SKILL.md` `requires:` is `[verify-claims]`.
- [ ] Its `description:` no longer says "after /finish".

## Story 3: Skill prose makes no false claims about the engine or hooks

As an operator reading `conduct` and `pipeline` skill prose, I want every claim about engine steps
and hook behavior to be true so that I can rely on it when deciding what will run.

### Acceptance Criteria

#### Happy Path
- Given `code-review` is not an engine step, when the tier-skip table in `skills/conduct/SKILL.md` is read, then it contains no `code-review` row.
- Given `hooks/claude/session-start-context.sh` does not read `.pipeline/progress.log`, when `skills/pipeline/SKILL.md`'s Progress Log section is read, then it makes no claim that a session-start hook reads that file.

#### Negative Paths
- Given the conduct tier-skip table after this change, when each row's first cell is compared with the engine's step names (hyphen/underscore equivalent) and step-mapped skill names, then the drift check (Story 5) fails for any row naming neither (e.g. a restored `code-review` row), naming that row.

### Done When
- [ ] `skills/conduct/SKILL.md` tier-skip table has no `code-review` row.
- [ ] `skills/pipeline/SKILL.md` no longer states that `session-start-context.sh` reads the last 30 lines of `.pipeline/progress.log`.

## Story 4: Step definitions name only skill directories that exist

As a maintainer, I want every built-in step's `skillName` to name a real skill directory so that the
definition never points at a skill that does not exist.

### Acceptance Criteria

#### Happy Path
- Given the `worktree` step (dispatched through the `conduct` skill invocation) and the engine-native `attribution_verify` step, when their step definitions are read, then neither carries a `skillName`.
- Given those two steps, when the engine dispatches them, then they dispatch exactly as before (the `worktree` step still invokes `conduct worktree`; `attribution_verify` stays engine-native).

#### Negative Paths
- Given any built-in step definition whose `skillName` has no `skills/<skillName>/SKILL.md`, when the drift check (Story 5) runs, then it fails naming the step and the missing skill directory.

### Done When
- [ ] `worktree` and `attribution_verify` step definitions have no `skillName`.
- [ ] Every remaining built-in step `skillName` resolves to an existing `skills/<name>/SKILL.md`.
- [ ] Existing dispatch tests for `worktree` and `attribution_verify` pass unchanged.

## Story 5: An automated check keeps frontmatter and engine in agreement

As a maintainer, I want the default test suite to fail when skill frontmatter drifts from the
engine's step definitions so that this class of drift cannot silently return.

### Acceptance Criteria

#### Happy Path
- Given the corrected repository, when the default vitest suite runs, then the frontmatter/engine drift check passes.
- Given a step-mapped skill, when the check computes its expected enforcement, then the expectation is derived from the engine's step definitions at test time (strictest level among the steps that name it), not from a hand-maintained list.

#### Negative Paths
- Given a step-mapped skill whose frontmatter `enforcement:` differs from its derived engine level (e.g. `memory` declaring `gating`), when the check runs, then it fails naming the skill, the declared value, the expected value, and the step(s) it was derived from.
- Given a built-in step whose `skillName` has no `skills/<name>/SKILL.md`, when the check runs, then it fails naming the step and the missing directory.
- Given a step-mapped skill whose `requires:` names a step-mapped skill that runs strictly later in engine order (e.g. `manual-test` requiring `finish`), when the check runs, then it fails naming both skills.
- Given a row in `skills/conduct/SKILL.md`'s tier-skip table whose first cell names neither an engine step (hyphen/underscore equivalent) nor a step-mapped skill, when the check runs, then it fails naming that row.
- Given a skill not named by any built-in step (e.g. `tdd`, `verify-claims`, a per-project override skill), when the check runs, then that skill's `enforcement:` is not compared and does not fail the check.

### Done When
- [ ] A vitest contract test exists in the default tier and passes on the corrected tree.
- [ ] Reverting any one Story 1, 2, 3 (code-review row), or 4 correction makes that test fail with a message naming the offending skill, step, or row.
