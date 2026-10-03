**Status:** Accepted

# Stories: Audited operator halt clear for in-place halts

Source: jstoup111/ai-conductor#2132. Technical track, Tier S.

## Story 1: Operator clears a resolved halt so the feature resumes at its halted step

**Requirement:** Technical intent — an audited operator command clears a live halt of any class and resumes the feature at its recorded step, including when the recorded step is the halted step itself.

As an operator who has resolved the cause of a halt, I want one audited command that clears it so that the daemon resumes the feature at the step that halted without hand-deleting halt markers or rewinding.

### Acceptance Criteria

#### Happy Path
- Given a feature worktree whose `.pipeline/HALT` exists, whose `.pipeline/HALT.class` reads `needs-human`, and whose `.pipeline/conduct-state.json` records `last_step` as `build`, when the operator runs `ai-conductor halt clear --feature <slug> --rationale "plan amended and resealed"` from an interactive terminal, then the command exits 0, both `.pipeline/HALT` and `.pipeline/HALT.class` are absent, and `last_step` is still `build`.
- Given the same successful clear, when the feature's `.pipeline/events.jsonl` is read, then it contains one `halt_clear_authorized` event carrying the resolved operator identity, the trimmed rationale, the cleared halt class `needs-human`, and the feature slug, appended before the halt markers were removed.
- Given the feature has a committed halt record at `.docs/halted/<slug>.md` with status halted, when the clear succeeds, then that record is committed as resolved with cause `operator`.
- Given a live halt whose class is `kickback-cap`, `plan-gap`, `over-scope`, or `protected-artifact`, when the operator runs the same command with a rationale, then the halt is cleared and the `halt_clear_authorized` event names that class.

#### Negative Paths
- Given a feature worktree with no `.pipeline/HALT`, when the operator runs `ai-conductor halt clear --feature <slug> --rationale "x"`, then the command exits non-zero with a message stating the feature is not halted, and no `halt_clear_authorized` event is appended.
- Given a live halt, when the operator runs the command with no `--rationale`, a whitespace-only rationale, or a rationale over the shared operator-rationale byte bound, then the command exits non-zero naming the rationale problem, and `.pipeline/HALT`, `.pipeline/HALT.class`, and `.pipeline/events.jsonl` are byte-for-byte unchanged.
- Given a live halt and a non-interactive invocation such as a daemon-dispatched agent session with no TTY on stdin, when the command runs, then it exits non-zero stating that clearing a halt requires an interactive local operator terminal, and the halt markers and event log are unchanged.
- Given a live halt and an operator identity that cannot be resolved through the shared operator-identity chain, when the command runs, then it exits non-zero naming the unresolved identity, and the halt markers and event log are unchanged.
- Given a `--feature` value that does not name a live directory under `.worktrees/`, when the command runs, then it exits non-zero naming the unknown feature and writes nothing.
- Given a live halt where appending the `halt_clear_authorized` event fails, when the command runs, then it exits non-zero and `.pipeline/HALT` and `.pipeline/HALT.class` are still present.
- Given a live halt whose committed halt record cannot be committed or pushed, when the clear runs, then the halt markers are still cleared, the `halt_clear_authorized` event is still appended, and the command prints a warning naming the record failure while exiting 0.

### Done When
- [ ] `ai-conductor halt clear --feature <slug> --rationale <text>` is a registered CLI command.
- [ ] After a successful clear, `.pipeline/HALT` and `.pipeline/HALT.class` are both absent and `conduct-state.json` `last_step` is unchanged.
- [ ] The appended `halt_clear_authorized` event includes the operator identity, the rationale, the prior halt class, and the feature slug.
- [ ] Every refusal exits non-zero and leaves the halt markers in place.

## Story 2: Build-stall remediation halt keeps the class remediation chose

**Requirement:** Technical intent — a halt raised from build-stall remediation is written with the halt class the remediation outcome carries, so class-scoped recovery routes apply.

As an operator triaging a build-stall halt, I want `.pipeline/HALT.class` to name the class remediation actually chose so that the matching recovery command applies.

### Acceptance Criteria

#### Happy Path
- Given a daemon build stall whose remediation outcome is a halt with class `kickback-cap` because remediation requested plan tasks with no plan-growth allowance, when the build-stall path writes the halt, then `.pipeline/HALT.class` reads `kickback-cap` and `.pipeline/HALT` still begins with the stall question followed by the outcome detail.

#### Negative Paths
- Given a daemon build stall whose remediation outcome is a halt carrying no halt class, when the build-stall path writes the halt, then `.pipeline/HALT.class` reads `needs-human`.
- Given a daemon build stall whose remediation misroutes to a non-build step or produces no valid dispositions, when the build-stall path writes the halt, then `.pipeline/HALT.class` reads `needs-human`.

### Done When
- [ ] A build-stall remediation halt outcome with class `kickback-cap` produces `HALT.class` `kickback-cap`.
- [ ] A build-stall remediation halt outcome without a class, a misroute, and a no-disposition outcome each produce `HALT.class` `needs-human`.

## Story 3: The build-stall path does not record its own marker clear as an operator action

**Requirement:** Technical intent — the conductor's consumption of the build agent's halt marker before remediation is attributed to the engine, never to the operator.

As an operator auditing whether a halt was cleared by a human, I want the conductor's own build-stall marker clear to carry a non-operator cause so that it is not mistaken for a human action.

### Acceptance Criteria

#### Happy Path
- Given a daemon build stall where the build agent wrote `.pipeline/HALT`, when the conductor clears that marker before dispatching remediation, then the appended `halt_cleared` event has cause `stall-remediation`, not `operator`.
- Given the same clear and an existing committed halt record for the feature, when the conductor supersedes that record, then the record's resolution cause is `stall-remediation`.

#### Negative Paths
- Given a daemon build stall whose remediation outcome is a halt, when the conductor clears the build agent's marker before remediation and later writes the remediation halt, then no `halt_cleared` event appended by that build-stall path has cause `operator` and no `halt_clear_authorized` event is appended.

### Done When
- [ ] The build-stall marker clear appends `halt_cleared` with cause `stall-remediation`.
- [ ] The build-stall path's committed halt-record supersession uses cause `stall-remediation`.

## Story 4: Rewind keeps refusing a target that is not strictly earlier

**Requirement:** Technical intent — the new clear path does not loosen `rewind`'s strictly-earlier guard.

As an operator, I want `rewind` to keep refusing the current step so that its downstream-invalidation contract is unchanged and in-place halts use `halt clear` instead.

### Acceptance Criteria

#### Happy Path
- Given a feature whose `last_step` is `build_review`, when the operator runs `ai-conductor rewind --to build`, then the rewind succeeds exactly as before this change.

#### Negative Paths
- Given a halted feature whose `last_step` is `build`, when the operator runs `ai-conductor rewind --to build`, then the command exits non-zero with `Rewind target "build" must be earlier than current step "build"` and `conduct-state.json`, `.pipeline/HALT`, and `.pipeline/HALT.class` are unchanged.

### Done When
- [ ] `rewind --to <current step>` still refuses with the existing message and mutates nothing.
- [ ] `rewind --to <earlier step>` behavior is unchanged.
