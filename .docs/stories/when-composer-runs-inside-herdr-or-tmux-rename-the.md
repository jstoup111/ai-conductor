**Status:** Accepted

# Stories: composer labels its pane with the idea slug and DECIDE phase

Technical track, tier S. Scope: the composer session's own herdr pane or tmux pane title only; no
reset after delivery, no pre-idea label, no daemon panes, no tmux window rename.

## Story 1: `compose phase` labels the composer's pane

As an operator running several composer sessions, I want each composer pane labelled with its idea
slug and current DECIDE phase so that I can see at a glance what every pane is working on.

### Acceptance Criteria

#### Happy Path
- Given a composer session inside a herdr pane (`HERDR_ENV=1`, `HERDR_PANE_ID` set) and an engineer worktree on branch `spec/<slug>`, when `ai-conductor compose phase --worktree <worktreePath> --phase stories` runs, then that herdr pane's label becomes `<slug> · stories` and the command exits 0
- Given a composer session inside a tmux pane (`TMUX_PANE` set), when `ai-conductor compose phase --worktree <worktreePath> --phase plan` runs, then the title of the pane named by `TMUX_PANE` becomes `<slug> · plan` and the command exits 0
- Given a session inside both a tmux pane and a herdr pane, when `compose phase` runs, then both the herdr pane label and the tmux pane title become `<slug> · <phase>`
- Given a labelled pane, when `compose phase` runs again with a different phase, then the label is replaced by `<slug> · <new phase>`

#### Negative Paths
- Given neither herdr (`HERDR_ENV` unset or not `1`) nor tmux (`TMUX_PANE` unset), when `compose phase` runs, then no `herdr` or `tmux` process is started and the command exits 0
- Given `TMUX` is set but `TMUX_PANE` is unset, when `compose phase` runs, then no `tmux` command is issued, so no implicitly targeted pane is ever relabelled
- Given a `--phase` value that is empty or contains anything other than lowercase letters, digits, and hyphens (for example an escape sequence or a space), when `compose phase` runs, then it exits non-zero naming the invalid phase and no pane is relabelled
- Given a `--worktree` path whose checked-out branch is not `spec/<slug>`, when `compose phase` runs, then it exits non-zero naming the path and no pane is relabelled
- Given the `herdr` or `tmux` command fails or does not finish within 2 seconds, when `compose phase` runs, then it prints a one-line warning to stderr and still exits 0

### Done When
- [ ] `ai-conductor compose phase --worktree <p> --phase <name>` is accepted by the compose CLI and listed in its help
- [ ] Inside herdr, the call issues exactly `herdr pane rename <HERDR_PANE_ID> "<slug> · <phase>"`
- [ ] Inside tmux, the call issues exactly `tmux select-pane -t <TMUX_PANE> -T "<slug> · <phase>"`
- [ ] Invalid phase and non-engineer worktree each exit non-zero with no multiplexer process started
- [ ] A failing or hung multiplexer command yields a stderr warning and exit 0 within the 2-second bound

## Story 2: compose primitives label the pane themselves

As an operator, I want the phases that run as compose primitives to update the label without the
agent remembering to, so that the label is right for every primitive-driven phase.

### Acceptance Criteria

#### Happy Path
- Given a composer session inside herdr or tmux, when `compose worktree` creates or reuses a worktree, then the pane label becomes `<slug> · worktree` using the slug it printed
- Given a composer session inside herdr or tmux, when `compose plan-review`, `compose land`, or `compose handoff` starts, then the pane label becomes `<slug> · plan-review`, `<slug> · land`, or `<slug> · handoff` respectively

#### Negative Paths
- Given the multiplexer command fails or times out, when any of those four primitives runs, then its stdout, side effects, and exit code are identical to a run with no multiplexer present, and its only added output is the one-line stderr warning
- Given a primitive that itself fails (for example `land` rejecting a DRAFT artifact), when it runs inside herdr or tmux, then its failure output and exit code are unchanged by the labelling

### Done When
- [ ] Each of `worktree`, `plan-review`, `land`, and `handoff` sets the label to `<slug> · <its name>` through the same helper `compose phase` uses
- [ ] A test with a failing multiplexer adapter shows each primitive's result and exit code unchanged

## Story 3: the composer skill asks for the chat-run phases

As an operator, I want the composer skill to tell the agent to label each phase it runs in chat, so
that explore, complexity, prd, architecture, stories, conflict-check, plan, and coherence phases
also show in the pane.

### Acceptance Criteria

#### Happy Path
- Given the composer skill, when an agent reads its DECIDE section, then it finds one short instruction to run `ai-conductor compose phase --worktree <worktreePath> --phase <step>` as each DECIDE step starts

#### Negative Paths
- Given the instruction is skipped for a phase, when the next primitive or `compose phase` call runs, then the label is corrected by that call and the composer flow is otherwise unaffected

### Done When
- [ ] `skills/composer/SKILL.md` carries the single instruction in its DECIDE section
- [ ] The instruction names `compose phase`, `--worktree`, and `--phase`, and is one sentence
