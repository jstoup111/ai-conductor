**Status:** Accepted

# Stories: Protected-artifact halt prints no recovery command

Source: jstoup111/ai-conductor#3321. Track: technical (no PRD). Tier: S.

A protected-artifact seal halt names the changed DECIDE artifact and its attribution, but not how an
operator approves a legitimate amendment. The supported route is `ai-conductor reseal`, which an
operator has to find in `--help`. These stories make the halt print the exact reseal invocation,
with the feature slug and every path it must name, and only when that invocation would succeed as
printed. Reseal's own flags, checks, TTY gate, and audit records are unchanged. Approving added,
deleted, or uncommitted protected artifacts stays out of scope: reseal refuses those by design.

In these stories, "the reseal hint" means these two lines appended after the halt's existing text,
where `<slug>` is the feature worktree's directory name under `.worktrees/` and the paths are
listed in sorted order:

- `Approve this change as an operator amendment by running, from the repository root that contains .worktrees/<slug>, in an interactive terminal:`
- `  ai-conductor reseal --slug <slug> --path <path> [--path <path> ...] --reason "«why»" --clear-halt`

## Story 1: A protected-artifact halt prints the reseal command for every changed path

**Requirement:** #3321 desired outcome 1

As an operator reading a protected-artifact halt, I want it to print the exact reseal invocation with the slug and every changed protected path filled in, so that I can approve a legitimate amendment without searching the CLI help.

### Acceptance Criteria

#### Happy Path
- Given a feature worktree at `.worktrees/feat-x` whose branch commits a change to the sealed .docs/decisions/adr-2026-10-17-example.md, when the BUILD entry seal check halts, then `.pipeline/HALT` keeps `Protected artifact changed: .docs/decisions/adr-2026-10-17-example.md` as its first line and its `Attribution: feature-authored (committed on this branch since merge-base <sha>)` line, and is followed by the reseal hint whose command line is exactly `  ai-conductor reseal --slug feat-x --path .docs/decisions/adr-2026-10-17-example.md --reason "«why»" --clear-halt`, with `.pipeline/HALT.class` still `protected-artifact`.
- Given a feature worktree at `.worktrees/feat-x` whose branch commits changes to two sealed artifacts .docs/decisions/adr-2026-10-17-a.md and .docs/decisions/adr-2026-10-17-b.md, when the BUILD entry seal check halts, then the HALT's first line still names only .docs/decisions/adr-2026-10-17-a.md and the reseal hint's command line is exactly `  ai-conductor reseal --slug feat-x --path .docs/decisions/adr-2026-10-17-a.md --path .docs/decisions/adr-2026-10-17-b.md --reason "«why»" --clear-halt`.

#### Negative Paths
- Given a feature whose project root is not a directory directly under a `.worktrees/` directory, when the seal check halts on a committed changed artifact, then the HALT text is identical to its text before this change and contains no `ai-conductor reseal` line.
- Given a changed sealed artifact whose path contains a space, when the seal check halts, then the reseal hint prints that `--path` value single-quoted so a POSIX shell passes it as one argument, and prints every other value without quotes.
- Given the reseal hint cannot be computed because the seal file is unreadable or a git probe fails, when the seal check halts, then the HALT is still written with class `protected-artifact` and its text is identical to its text before this change, with no `ai-conductor reseal` line.

### Done When
- [ ] A BUILD halt on one committed changed sealed artifact ends with the two reseal hint lines naming the worktree slug and that path.
- [ ] A BUILD halt on two committed changed sealed artifacts prints one command naming both paths in sorted order.
- [ ] A halt outside a `.worktrees/` worktree, or whose hint cannot be computed, is byte-identical to the pre-change halt text.

## Story 2: The printed reseal command succeeds as shown

**Requirement:** #3321 desired outcome 2

As an operator who has decided a halted change is a legitimate amendment, I want to run the printed command as shown from the place the halt names, so that the approval is recorded and the halt is cleared on the first try.

### Acceptance Criteria

#### Happy Path
- Given the HALT from Story 1's two-artifact scenario, when the operator runs its printed command line unchanged in an interactive terminal from the repository root that contains `.worktrees/feat-x`, then reseal exits 0 printing `Resealed protected artifacts: .docs/decisions/adr-2026-10-17-a.md, .docs/decisions/adr-2026-10-17-b.md`, removes `.pipeline/HALT` and `.pipeline/HALT.class`, and the next BUILD entry seal check for that worktree passes.

#### Negative Paths
- Given a seal check that halts and prints the reseal hint, when the halt is written, then `.pipeline/protected-artifact-seal.json` is byte-identical to its content before the check and no `protected_artifact_reseal` or `protected_artifact_reseal_refused` event is recorded, so printing the hint approves nothing.
- Given the printed command line is run without an interactive terminal, when reseal dispatches, then it refuses with `reseal: requires an interactive terminal.`, exits 1, and leaves the HALT, the HALT class, and the seal file unchanged.

### Done When
- [ ] Running the exact printed command line from the repository root reseals every named path, exits 0, and clears the protected-artifact HALT.
- [ ] Computing the hint writes nothing to the seal file and records no reseal audit event.

## Story 3: No reseal command is printed when reseal cannot approve the change

**Requirement:** #3321 desired outcome 2

As an operator reading a protected-artifact halt that reseal cannot approve, I want the halt to print no reseal command, so that I am never handed a command that refuses.

### Acceptance Criteria

#### Happy Path
- Given a protected-artifact halt that prints no reseal hint, when the operator reads it, then its text is identical to the halt text this scenario produced before this change.

#### Negative Paths
- Given a feature branch that commits a change to the sealed .docs/decisions/adr-2026-10-17-a.md and also commits the new, unsealed .docs/decisions/adr-2026-10-17-new.md, when the seal check halts, then the HALT contains no `ai-conductor reseal` line.
- Given a sealed artifact whose change is present in the workspace but not committed, when the seal check halts, then the HALT contains no `ai-conductor reseal` line.
- Given a sealed artifact deleted on the feature branch rather than inherited from the base branch, when the seal check halts, then the HALT contains no `ai-conductor reseal` line.

### Done When
- [ ] Halts for an added unsealed artifact, an uncommitted change, and a feature-branch deletion each contain no `ai-conductor reseal` line and keep their pre-change text.
