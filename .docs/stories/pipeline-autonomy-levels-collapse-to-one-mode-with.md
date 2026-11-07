**Status:** Accepted

# Stories: The pipeline runs one mode with a host-sized parallel cap

## Story 1: Independent tasks fan out up to the host's free slots, never halting for slots

**Requirement:** Pipeline skill execution mode

As an operator, I want `/pipeline` to have a single execution mode that runs up to X independent tasks at once, with X sized to the host's free sub-agent slots, so that I am never asked to choose an autonomy level or halted because a host has fewer slots.

### Acceptance Criteria

#### Happy Path
- Given a ready frontier of three independent tasks on Claude Code, when the pipeline fans out, then it dispatches all three in one host-native fan-out operation.
- Given a ready frontier of three independent tasks on Codex with two free sub-agent slots, when the pipeline fans out, then X is 2 and it dispatches two in one fan-out and the third in the next frontier.

#### Negative Paths
- Given a host with no free sub-agent slot or no native fan-out, when the pipeline reaches a frontier, then X is 1 and it runs the frontier sequentially in its own session without halting or asking the operator to choose a mode.
- Given the pipeline skill, when it is read, then it defines no Conservative, Standard or Full autonomy level.

### Done When
- [ ] `test/test_provider_skill_contracts.sh` asserts the min(3, free slots) cap, sequential execution at X = 1, the no-halt rule, and the absence of autonomy levels in `skills/pipeline/SKILL.md`.

## Story 2: Bootstrap suggests the host settings that size the parallel cap

**Requirement:** Bootstrap host setup

As an operator, I want `/bootstrap` to point out a Codex or Claude Code sub-agent setting that would cap the pipeline below 3 parallel tasks, so that I can raise it before a build runs sequentially.

### Acceptance Criteria

#### Happy Path
- Given a Codex install whose `[agents] max_threads` leaves fewer than 3 free sub-agents, when bootstrap runs, then it shows the `[agents] max_threads = 6` change and asks before editing `~/.codex/config.toml`.
- Given Claude Code with `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` set below 4, when bootstrap runs, then it suggests raising it and asks before editing settings.

#### Negative Paths
- Given the operator declines, when bootstrap continues, then neither operator-level file is changed.

### Done When
- [ ] `test/test_provider_skill_contracts.sh` asserts that `skills/bootstrap/SKILL.md` names both settings and never edits them without the operator's approval.
