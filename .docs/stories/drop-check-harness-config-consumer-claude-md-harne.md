**Status:** Accepted

# Stories: Drop check_harness_config (consumer CLAUDE.md → HARNESS.md auto-upgrade)

Technical track, Tier S. Detection of a missing HARNESS.md reference is retained by
`hooks/claude/session-start-context.sh` (it prints the block to add). Only the intrusive
auto-`git commit` behavior in `bin/conduct` is removed.

## Story: Remove the check_harness_config function and its call site

**Requirement:** Technical — drop the auto-upgrade mechanism from `bin/conduct`.

As a harness maintainer, I want `check_harness_config` and its launch-time invocation removed
from `bin/conduct`, so that the v1.0 cutover (removing `bin/conduct` entirely, #226) is not
blocked by an un-ported feature and consumers' CLAUDE.md files are never auto-committed to.

### Acceptance Criteria

#### Happy Path
- Given `bin/conduct` defines `check_harness_config()` at line 466, when the change is applied,
  then the entire function body (through its closing brace) is deleted.
- Given `bin/conduct` invokes `check_harness_config` at line 2897, when the change is applied,
  then that call line is deleted so the launch path no longer runs it.
- Given the edited `bin/conduct`, when `bash -n bin/conduct` runs, then it exits 0 (valid syntax).

#### Negative Paths
- Given the change is complete, when `grep -rn "check_harness_config"` is run over the repo
  excluding `.docs/`, then zero matches remain in `bin/`, `hooks/`, `HARNESS.md`, or `CLAUDE.md`
  (no dangling reference to a removed function).

### Done When
- [ ] `check_harness_config()` function (formerly `bin/conduct:466-505`) is absent from `bin/conduct`.
- [ ] The `check_harness_config` call (formerly `bin/conduct:2897`) is absent from `bin/conduct`.
- [ ] `bash -n bin/conduct` exits 0.
- [ ] `grep -rn "check_harness_config" .` (excluding `.docs/`) returns no matches.

## Story: Reconcile documentation to remove the auto-upgrade claim

**Requirement:** Technical — docs must not advertise a mechanism that no longer exists (harness
"Docs track features" convention).

As a harness maintainer, I want `CLAUDE.md` (and `HARNESS.md` if applicable) to stop advertising
`check_harness_config` auto-detection/auto-upgrade and instead point at the session-start hook,
so that documentation matches the shipped behavior.

### Acceptance Criteria

#### Happy Path
- Given `CLAUDE.md:126` in the "HARNESS.md Flow" section claims `check_harness_config()`
  auto-detects and prompts to upgrade, when the change is applied, then that bullet no longer
  references `check_harness_config` and instead states that
  `hooks/claude/session-start-context.sh` detects a missing HARNESS.md reference and prints the
  block to add manually.
- Given `HARNESS.md` is inspected for any auto-upgrade / `check_harness_config` reference, when
  none is found, then `HARNESS.md` requires no edit (verified, not assumed).

#### Negative Paths
- Given the docs are updated, when `test/test_harness_integrity.sh` runs, then it passes (no
  broken cross-references introduced by the doc edits).

### Done When
- [ ] The "HARNESS.md Flow" bullet in `CLAUDE.md` no longer mentions `check_harness_config` or an
      auto-commit/auto-upgrade of consumer CLAUDE.md files.
- [ ] `CLAUDE.md` points at `hooks/claude/session-start-context.sh` as the detection surface.
- [ ] `HARNESS.md` confirmed to carry no stale auto-upgrade claim (edited only if one exists).
- [ ] `test/test_harness_integrity.sh` passes.
