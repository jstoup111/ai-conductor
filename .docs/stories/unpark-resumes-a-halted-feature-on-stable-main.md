**Status:** Accepted

# Stories: unpark names the live HALT it leaves behind (#822)

Track: technical (no PRD — acceptance criteria live here)
Tier: S

## Context

`ai-conductor daemon unpark <slug>` removes only the operator park marker (`.daemon/parked/<slug>`)
and resets the no-evidence counter. It then prints `normal dispatch and re-kick resume`. A feature
whose worktree still holds a live `.pipeline/HALT` does not resume: the daemon's selection skips
any slug with a live HALT, and on a stable `main` nothing clears it. The operator in #822 believed
the output, and an 18-task build sat stranded until they rewrote `.daemon/last-base-sha` by hand.

Unpark stays park-only (operator decision, recorded in the track marker). It never clears,
renames, or rewrites a HALT, and it never triggers a dispatch or re-kick. What changes is its
output. When a live HALT remains, unpark states that the feature will not resume until the HALT is
dealt with, and names the recovery that fits the halt's `.pipeline/HALT.class`. A single generic
"remove the HALT" instruction is unsafe for two classes. For an `over-scope` halt, deleting the
body discards the operator's recorded decisions (the runbook requires renaming it to
`HALT.cleared`). A `kickback-cap` halt resumes through `ai-conductor kickback-budget`, not by
deleting the marker.

In the criteria below, "the feature's HALT" means `.worktrees/<slug>/.pipeline/HALT` under the
main repo root that unpark already resolves, and "the class" means the trimmed text of the sibling
`.pipeline/HALT.class`. "The runbook" means `docs/runbooks/stalled-or-stuck-feature.md`.

## Story 1: Unparking a parked feature with a live HALT names the class-specific recovery

**Requirement:** #822 (technical; unpark output only)

As an operator unparking a halted feature, I want unpark to tell me the feature is still halted
and exactly how to resume it for its halt class, so that I am not left believing a stranded
feature will resume on its own.

### Acceptance Criteria

#### Happy Path
- Given an operator-parked slug whose worktree has a live HALT with class `mechanical`, when `ai-conductor daemon unpark <slug>` runs, then it exits 0, removes the park marker, omits the text `normal dispatch and re-kick resume`, prints that the feature will not resume until its HALT is cleared, names the class `mechanical`, and names removing both `.pipeline/HALT` and `.pipeline/HALT.class` in that worktree as the recovery.
- Given an operator-parked slug whose worktree has a live HALT with no `HALT.class` file, or with class `legacy`, when unpark runs, then the output names the class (`unclassified` for the absent file, `legacy` otherwise) and gives the same remove-both recovery as `mechanical`.
- Given an operator-parked slug whose worktree has a live HALT with class `over-scope`, when unpark runs, then the output names the class, directs the operator to record each decision in the HALT body and then rename `.pipeline/HALT` to `.pipeline/HALT.cleared`, and contains no instruction to remove or delete `.pipeline/HALT`.
- Given an operator-parked slug whose worktree has a live HALT with class `kickback-cap`, when unpark runs, then the output names the class, names `ai-conductor kickback-budget` as the recovery command, and contains no instruction to remove or delete `.pipeline/HALT`.
- Given an operator-parked slug whose worktree has a live HALT with class `needs-human`, `plan-gap`, or `protected-artifact`, when unpark runs, then the output names the class, states that the cause recorded in the HALT body must be resolved before the HALT is cleared, and names the runbook path.
- Given an operator-parked slug whose worktree has no live HALT, when unpark runs, then the output is unchanged from today: it still ends with `normal dispatch and re-kick resume` and prints no HALT warning.

#### Negative Paths
- Given an operator-parked slug with a live HALT of any class, when unpark runs, then `.pipeline/HALT`, `.pipeline/HALT.class`, and any `.pipeline/HALT.cleared` in that worktree are byte-identical before and after, and no re-kick sentinel file is created.
- Given an operator-parked slug whose live HALT has a class text unpark does not recognize (for example `future-class`), when unpark runs, then the output prints that raw class text, gives the resolve-the-cause-first recovery with the runbook path, and contains no instruction to remove or delete `.pipeline/HALT`.
- Given an operator-parked slug whose live HALT has a `HALT.class` path that exists but cannot be read as a file, when unpark runs, then unpark still exits 0 and removes the park marker, and the warning gives the resolve-the-cause-first recovery with the runbook path rather than the remove-both recovery.
- Given an operator-parked slug with no `.worktrees/<slug>` directory, when unpark runs, then it takes the existing worktree-missing fallback, exits 0, removes the park marker, and prints no HALT warning.

### Done When
- [ ] Unit tests of `dispatchDaemonPark` cover one unparked-with-live-HALT case per class group (`mechanical`, absent sidecar, `legacy`, `over-scope`, `kickback-cap`, `needs-human`, `plan-gap`, `protected-artifact`, an unrecognized class, an unreadable sidecar) and assert on the captured output lines.
- [ ] Each of those tests asserts exit code 0, the park marker is absent afterwards, and the HALT, HALT.class, and HALT.cleared bytes are unchanged.
- [ ] The `over-scope`, `kickback-cap`, unrecognized-class, and unreadable-sidecar tests assert that no output line instructs removing `.pipeline/HALT`.
- [ ] The no-live-HALT and worktree-missing tests assert that the output still contains `normal dispatch and re-kick resume` and no HALT warning line.

## Story 2: Unparking a never-parked feature with a live HALT names the recovery instead of "nothing to do"

**Requirement:** #822 (technical; unpark output only)

As an operator who runs unpark on a halted feature that was never operator-parked, I want unpark to
say the feature is halted and how to resume it, so that `nothing to do` does not read as "this
feature is free to run".

### Acceptance Criteria

#### Happy Path
- Given a slug with no park marker whose worktree has a live HALT with class `mechanical`, when unpark runs, then it exits 0, still prints `was not operator-parked — nothing to do.`, and follows it with the same HALT warning and class-specific recovery Story 1 prints for that class.
- Given a slug with no park marker whose worktree has a live HALT with class `over-scope`, when unpark runs, then the warning directs the rename to `.pipeline/HALT.cleared` and contains no instruction to remove or delete `.pipeline/HALT`.
- Given a slug with no park marker and no live HALT, when unpark runs, then the output is exactly today's single `was not operator-parked — nothing to do.` line.

#### Negative Paths
- Given a slug with no park marker whose worktree has a live HALT, when unpark runs, then no park marker is created, the no-evidence counter is not reset, and the HALT, HALT.class, and HALT.cleared bytes are unchanged.
- Given a slug with no park marker and no `.worktrees/<slug>` directory, when unpark runs, then it exits 0 and prints only the `nothing to do` line, with no error and no HALT warning.

### Done When
- [ ] Unit tests of `dispatchDaemonPark` cover the not-parked branch with a live `mechanical` HALT, a live `over-scope` HALT, no HALT, and a missing worktree, and assert on the captured output lines.
- [ ] The live-HALT tests assert that no park marker exists afterwards, that the no-evidence counter file is unchanged, and that the HALT files are byte-identical.
