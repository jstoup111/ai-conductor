# bin/install --uninstall removes installer settings and reports preserved state

**Status:** Accepted

## Context

`bin/install --uninstall` removes the harness-owned skill links and the three launchers, but it leaves the
harness hook entries and permission entries that install wrote into `~/.claude/settings.json`. It also leaves
the global rate-card link and all of `~/.ai-conductor/`, and says nothing about any of them. After uninstall,
the hooks keep firing in every Claude Code session. If the checkout is deleted, they point at a directory that
no longer exists. Intake: jstoup111/ai-conductor#1004.

The operator-confirmed scope is minimal. A hook entry is harness-owned when its command lives under this
checkout's `hooks/claude/` directory. A permission is harness-owned when it exactly matches an entry of the
installer's permission list. `~/.ai-conductor/` is kept by default, apart from the rate-card link, and a new
`--purge` flag deletes it. Out of scope: hooks that point at a different harness checkout, the legacy
`~/.claude/ai-conductor.config.json` files, and tools that install bootstrapped (viewers, renderers, brew
packages).

"Pre-install state" for `~/.claude/settings.json` means the parsed JSON is equal. Key order and whitespace
may differ, because install rewrites the file with its own formatting.

## Story 1: Uninstall removes the harness hooks and permissions from Claude Code settings

As an operator uninstalling the harness, I want the hook and permission entries install added to
`~/.claude/settings.json` removed, while my own settings stay untouched, so Claude Code stops running harness
hooks after uninstall.

### Acceptance Criteria

#### Happy Path
- Given a settings file holding every harness hook entry and harness permission alongside an operator-authored hook, an operator-authored permission, and an unrelated top-level key, when `bin/install --uninstall` runs, then every hook command under this checkout's `hooks/claude/` directory and every exact-match harness permission is gone, and the operator-authored hook, permission, and unrelated key are unchanged.
- Given a hook event array and a permissions allow list that contain only harness entries, when uninstall removes them, then the emptied event array, the emptied `hooks` object, the emptied `allow` list, and the emptied `permissions` object are removed rather than left empty.
- Given one hook entry group that holds both a harness hook command and an operator-authored hook command, when uninstall runs, then the harness command is removed from that group and the group survives with the operator-authored command and its matcher intact.
- Given uninstall has removed settings entries, when it reports, then its output names the settings file and the number of hook commands and permissions it removed.

#### Negative Paths
- Given a hook command that points at a `hooks/claude/` script with a harness script name but under a different directory than this checkout, when uninstall runs, then that hook entry is preserved unchanged.
- Given an operator-authored permission that differs from a harness permission only by its path or pattern, when uninstall runs, then that permission is preserved unchanged.
- Given a settings file that already held an empty `hooks` object or an empty `allow` list before uninstall, when uninstall runs, then that pre-existing empty container is preserved.
- Given no `~/.claude/settings.json` exists, when uninstall runs, then no settings file is created and uninstall reports that there were no settings entries to remove.
- Given `~/.claude/settings.json` holds malformed JSON, when uninstall runs, then the file is left byte-for-byte unchanged, uninstall warns that it could not remove harness settings from that file, the remaining uninstall steps still run, and uninstall ends with the `Uninstall incomplete` summary and a non-zero exit status.
- Given `python3` is not available, when uninstall runs, then the settings file is left byte-for-byte unchanged, uninstall warns that harness hooks and permissions remain in that file, the remaining uninstall steps still run, and uninstall exits non-zero with the `Uninstall incomplete` summary.

### Done When
- [ ] After uninstall, no hook command in `~/.claude/settings.json` starts with this checkout's `hooks/claude/` path and no permission in its allow list matches an installer permission entry.
- [ ] Operator-authored hooks, operator-authored permissions, and unrelated keys parse to the same JSON values as before uninstall.
- [ ] A malformed settings file keeps its exact bytes, and uninstall exits non-zero with a warning that names the file.

## Story 2: Uninstall removes the rate-card link and reports the state it keeps

As an operator uninstalling the harness, I want the installer's global rate-card link removed and a clear report
of what uninstall deliberately keeps under `~/.ai-conductor/`, so I know what remains and why.

### Acceptance Criteria

#### Happy Path
- Given `~/.ai-conductor/rate-card.json` is a symlink to this checkout's committed rate card, when `bin/install --uninstall` runs, then the link is removed and the output reports its removal.
- Given `~/.ai-conductor/` exists and still holds content after the rate-card link is removed, when uninstall finishes, then `~/.ai-conductor/` and its contents are left in place, and the output names the directory, says it holds operator configuration and runtime data such as the project registry and memory, and says that `--purge` removes it.

#### Negative Paths
- Given `~/.ai-conductor/rate-card.json` is a regular file, when uninstall runs, then the file is preserved and uninstall warns that the rate card is not a harness link.
- Given `~/.ai-conductor/rate-card.json` is a symlink to a path outside this checkout, when uninstall runs, then the link is preserved and uninstall warns that it points elsewhere.
- Given `~/.ai-conductor/` does not exist, when uninstall runs, then uninstall creates nothing there, prints no kept-state line for it, and still exits 0.

### Done When
- [ ] After uninstall, `~/.ai-conductor/rate-card.json` is absent when it was this checkout's link, and unchanged otherwise.
- [ ] Uninstall output contains a kept-state line naming `~/.ai-conductor/` and `--purge` whenever that directory remains.

## Story 3: `--purge` removes the harness state directory

As an operator who wants a completely clean slate, I want `bin/install --uninstall --purge` to also delete
`~/.ai-conductor/`, so that a later reinstall starts from nothing.

### Acceptance Criteria

#### Happy Path
- Given an installed harness with a populated `~/.ai-conductor/`, when `bin/install --uninstall --purge` runs, then everything plain uninstall removes is removed, `~/.ai-conductor/` no longer exists, and the output reports that it was purged.
- Given `~/.ai-conductor` is a symlink to a directory, when `--uninstall --purge` runs, then the symlink is removed and the directory it points to is left unchanged.

#### Negative Paths
- Given `--purge` is passed without `--uninstall`, when `bin/install` runs, then it prints the usage text, exits 1, and changes nothing on disk.
- Given `HOME` is unset or empty, when `bin/install --uninstall --purge` runs, then no directory is deleted, the purge is refused with a message naming the unresolved home directory, and the command exits non-zero.
- Given `~/.ai-conductor/` does not exist, when `--uninstall --purge` runs, then uninstall reports that there is nothing to purge and exits 0.

### Done When
- [ ] After `--uninstall --purge`, the path `$HOME/.ai-conductor` does not exist.
- [ ] `bin/install --purge` exits 1 and leaves every file under the test `HOME` unchanged.
- [ ] The `--help` usage text lists `--purge` alongside `--uninstall`.

## Story 4: Install then uninstall returns the operator's environment to its pre-install state

As an operator, I want installing and then uninstalling the harness to leave my home directory as it was, so that
uninstalling is a safe way to back out or to prepare a clean reinstall.

### Acceptance Criteria

#### Happy Path
- Given a fresh `HOME` whose `~/.claude/settings.json` holds operator-authored hooks, permissions, and other keys, when `bin/install` and then `bin/install --uninstall --purge` run, then the settings file parses to the same JSON value as before install, the Claude and Codex skill directories and `~/.local/bin` hold no harness entries, and `~/.ai-conductor/` does not exist.
- Given the same fresh `HOME`, when `bin/install` and then `bin/install --uninstall` run without `--purge`, then the result matches the purged round trip except that `~/.ai-conductor/` remains, and the output reports it as kept.

#### Negative Paths
- Given uninstall has already completed, when `bin/install --uninstall` runs a second time, then it exits 0, reports that no harness settings entries were found to remove, and leaves `~/.claude/settings.json` byte-for-byte unchanged.
- Given a fresh `HOME` with no `~/.claude/settings.json`, when install then uninstall run, then the settings file that install created contains no harness hooks or permissions afterwards and parses to an empty JSON object.

### Done When
- [ ] An automated round-trip check runs install then uninstall against a throwaway `HOME` and compares the parsed settings JSON before and after.
- [ ] The round-trip check covers both the purged and the non-purged uninstall.
- [ ] A second uninstall run leaves the settings file byte-identical and exits 0.
