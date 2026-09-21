# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-09-21T16:12:19.741Z
Slug: install-requires-a-manual-git-clone-no-curl-based-
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-install-requires-a-manual-git-clone-no-curl-based-
Head SHA: 3cffb8edf832c9fee4eb9567ccb16319165adb57
Halted at: 2026-09-21T14:11:50.835Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the criterion.

Criterion: Story 1 happy: Given the same machine, when the one-liner runs, then the existing installer is run from the canonical location and the resulting machine state matches what a manual install on the same channel produces.
Task ids: 3
Done when checks: `acquire` clones the default `https://` `REPO_URL` (overridable only through `AI_CONDUCTOR_REPO_URL`) into `$HOME/.ai-conductor/harness`, asserted by the fresh-install test finding a `.git` directory there and exit 0 when the script is fed to `sh -s` on stdin with no credentials in the environment. | `run_installer` executes `bin/install` from inside `$HOME/.ai-conductor/harness` and the script exits with its status, asserted by the stub installer's record naming that directory and by the script mirroring a stub exit code. | `announce` prints the canonical location and the channel before `acquire` runs, asserted by the fresh-install test checking both strings appear in stdout ahead of the first clone output.
Missing assertion: No cited check explicitly compares the resulting machine state with a manual install on the same channel.

Criterion: Story 5 happy: Given the canonical location holds a harness checkout that is already current, when the one-liner runs, then it reports that the installation is current, exits 0, and the checkout's commit is unchanged.
Task ids: 9
Done when checks: `main` routes an `ours` target to `run_updater` and never to `acquire`, asserted by the second-run test finding one new stub-updater record at the canonical location, no `clone` in the recorded git subcommands, exit 0, the updater's status line in stdout, and an unchanged HEAD. | `run_updater` executes the checkout's own `bin/update` when the channel has advanced, asserted by the behind-channel test finding the stub-updater record and no new stub-installer record. | `run_updater` propagates the updater's exit status and output, asserted by the failing-updater test observing exit 7 and the stub's message.
Missing assertion: No cited check explicitly requires reporting that the installation is current when the checkout is already current.

Criterion: Story 5 negative: Given the existing updater fails, when the one-liner runs, then the one-liner exits with the updater's non-zero status and its message, and the checkout is left as the updater left it.
Task ids: 9
Done when checks: `main` routes an `ours` target to `run_updater` and never to `acquire`, asserted by the second-run test finding one new stub-updater record at the canonical location, no `clone` in the recorded git subcommands, exit 0, the updater's status line in stdout, and an unchanged HEAD. | `run_updater` executes the checkout's own `bin/update` when the channel has advanced, asserted by the behind-channel test finding the stub-updater record and no new stub-installer record. | `run_updater` propagates the updater's exit status and output, asserted by the failing-updater test observing exit 7 and the stub's message.
Missing assertion: No cited check explicitly requires the checkout to be left exactly as the updater left it.

Criterion: Story 5 negative: Given two runs of the one-liner start at the same moment on a fresh machine, when both reach acquisition, then exactly one checkout results and the losing run exits non-zero or hands off to the update path — never a corrupted or duplicated installation.
Task ids: 10
Done when checks: `acquire` takes `harness.lock` with an atomic `mkdir` and calls `fail` naming the lock when it already exists, asserted by the held-lock test observing a non-zero exit, an absent harness directory, and the foreign lock still present. | `cleanup` removes the lock only when this process set `LOCK_HELD`, asserted by the two-runs test finding exactly one checkout that passes `git fsck`, no leftover lock or partial directory, and at most one non-zero exit.
Missing assertion: No cited check explicitly requires a successful losing run to hand off to the update path.

Criterion: Story 9 negative: Given the documentation site's build would transform or drop the script, when the site is built, then an automated check fails — the script must be published verbatim as a plain file.
Task ids: 12
Done when checks: The integrity block asserts `docs/_config.yml` contains no `exclude` pattern matching `docs/install.sh`, so the site configuration publishes the script from the documentation tree. | The integrity block asserts `bin/bootstrap` is a symbolic link with target `../docs/install.sh` and that both paths resolve to the same file via `readlink -f`. | The integrity block asserts `docs/install.sh` is a regular non-symlink file whose first line is `#!/bin/sh`, and fails when a `---` front-matter line is placed at the top.
Missing assertion: No cited check builds the documentation site or verifies that the published script is present verbatim and causes an automated failure if transformed or dropped.
```
