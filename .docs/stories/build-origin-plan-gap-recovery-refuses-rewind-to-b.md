**Status:** Accepted

# Stories: BUILD-origin plan-gap recovery

Source: jstoup111/ai-conductor#2990. Technical track, Tier S.

## Story 1: A rewind refused at the halted step names the in-place recovery

**Requirement:** Technical intent — an operator whose `rewind` targets the halted feature's own unfinished step is told the supported way to resume that step, while the refusal still changes nothing.

As an operator recovering a plan gap raised inside BUILD, I want the refused `rewind --to build` to name the in-place recovery command so that I can resume the amended BUILD without editing state or halt markers by hand.

### Acceptance Criteria

#### Happy Path
- Given a feature worktree directory named `<slug>` with `.pipeline/HALT`, `.pipeline/HALT.class` reading `plan-gap`, and `.pipeline/conduct-state.json` recording `last_step` `build` with `build` status `refused`, when the operator runs `ai-conductor rewind --to build` from that worktree, then the command exits 1, still prints `rewind: Rewind target "build" must be earlier than current step "build"`, also prints a line naming `ai-conductor halt clear --feature <slug> --rationale`, and `conduct-state.json`, `.pipeline/HALT`, and `.pipeline/HALT.class` are byte-for-byte unchanged.
- Given the same halted worktree except that the `build` status is `failed`, when the operator runs `ai-conductor rewind --to build`, then the command exits 1, prints the same refusal message and the same `ai-conductor halt clear --feature <slug> --rationale` line, and all three files are byte-for-byte unchanged.

#### Negative Paths
- Given a halted feature whose `last_step` is `build` and whose `build` status is `done`, when the operator runs `ai-conductor rewind --to build`, then the command exits 1 with the existing refusal message, prints no line mentioning `halt clear`, and `conduct-state.json`, `.pipeline/HALT`, and `.pipeline/HALT.class` are byte-for-byte unchanged.
- Given a halted feature whose `last_step` is `build` and whose `build` status is `refused`, when the operator runs `ai-conductor rewind --to test_suite`, then the command exits 1 with `rewind: Rewind target "test_suite" must be earlier than current step "build"`, prints no line mentioning `halt clear`, and the three files are byte-for-byte unchanged.
- Given a feature worktree with no `.pipeline/HALT` whose `last_step` is `build` and whose `build` status is `refused`, when the operator runs `ai-conductor rewind --to build`, then the command exits 1, prints no line mentioning `halt clear`, and `conduct-state.json` is byte-for-byte unchanged.

### Done When
- [ ] `rewind --to <step>` refused because `<step>` is the recorded `last_step` with status `refused` or `failed` prints the existing refusal message plus a line naming `ai-conductor halt clear --feature <slug> --rationale`, where `<slug>` is the worktree directory name.
- [ ] Every refusal in this story exits 1 and leaves `conduct-state.json` and any halt markers byte-for-byte unchanged.
- [ ] No refusal other than the in-place `refused`/`failed` case prints the `halt clear` line.

## Story 2: Daemon triage routes a BUILD-origin plan gap to the in-place recovery

**Requirement:** Technical intent — the shipped triage guidance recommends a recovery the CLI will accept for the plan gap's actual origin.

As an operator following daemon triage for a plan-gap halt, I want the recommended recovery to match where the gap was raised so that the documented sequence completes instead of stopping at a refused rewind.

### Acceptance Criteria

#### Happy Path
- Given a plan-gap halt whose `conduct-state.json` records `last_step` `build` (raised by BUILD's plan-gap report), when the `daemon-triage` skill's classification table is applied, then its plan-gap guidance directs: amend the indicted artifact, reseal, then clear the halt in place with `ai-conductor halt clear --feature <slug> --rationale "<...>"`, and unpark only afterwards, explicitly.

#### Negative Paths
- Given a plan-gap halt whose `last_step` is a step after `build` (raised by `prd_audit` or the as-built architecture review), when the `daemon-triage` skill's classification table is applied, then its plan-gap guidance still directs amend, reseal, and `ai-conductor rewind --to build`, and does not direct `halt clear` for that origin.

### Done When
- [ ] The `daemon-triage` plan-gap guidance names both origins, keyed on the recorded `last_step`, and the recovery command for each.
- [ ] The guidance keeps the existing warning that clearing the marker without amending an artifact re-halts.
