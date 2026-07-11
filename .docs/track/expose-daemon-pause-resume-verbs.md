# Track Decision — expose-daemon-pause-resume-verbs

**Track:** Technical
**Status:** Accepted

## Idea

The daemon `pause` / `resume` verbs shipped functional in PR #296 (durable
`.daemon/PAUSED` marker, single-repo + fleet dispatch) but are **undiscoverable**:

- `conduct daemon --help` lists `status/logs/park/unpark/start/stop/restart/connect/debug`
  but **not** `pause` or `resume` (`src/conductor/src/cli.ts:149–197`).
- `src/conductor/README.md` describes pause semantics in prose (~line 659) but never
  shows the command forms.
- `restart`'s help text (`cli.ts:191`) still reads "Restart this repo's tmux-supervised
  daemon" — no mention of the respawn-in-place / session-preserving semantics added
  alongside the lifecycle work.

Origin: `jstoup111/ai-conductor#304` (Refs #215 / PR #296).

## Why technical (not product)

There is **no new user-facing behavior**. The verbs already work end-to-end; this
change only surfaces existing capability in the commander/help tree and the two
READMEs. There are no functional requirements to enumerate in a PRD — the "requirement"
is entirely "make the shipped verbs discoverable and documented." Acceptance criteria
live directly in the stories, derived from technical intent. → **PRD skipped** (technical track).

## Grounding (real code, current state)

- **Registration site:** `src/conductor/src/cli.ts` — the `daemon` command builder. Each
  management verb is declared with `daemon.command('<verb>').description('…')` **solely so
  `--help` documents it**; commander never dispatches these (see the comment block at
  `cli.ts:179–181`). Dispatch happens earlier in `index.ts` via
  `detectDaemonSupervisorCommand`.
- **Verb recognition:** `src/conductor/src/engine/daemon-command.ts:78–79` already lists
  `pause` and `resume` in `MANAGEMENT_VERBS`, and `DAEMON_SUBVERBS` (line 116) already
  includes them via the `MANAGEMENT_VERBS` spread — so they are recognized and never
  mis-routed to a daemon run. **Only the `--help` declaration is missing.**
- **Fleet selector — actual form:** `detectDaemonSupervisorCommand`
  (`daemon-command.ts:91–109`) parses `--all` and treats **bare positional tokens** after
  the verb as named-repo targets (`names = rest.filter(a => !a.startsWith('-'))`). There is
  **no `--names` flag** anywhere in the codebase (the intake issue's mention of `--names`
  is imprecise). The correct fleet forms are:
  - `conduct daemon pause` / `conduct daemon resume` — act on the current repo
  - `conduct daemon pause --all` / `conduct daemon resume --all` — every registered repo
  - `conduct daemon pause <repoA> <repoB>` — a named subset (bare positional repo names)
- **Behavior to document:** `daemon-supervisor-cli.ts:196–213` (fleet) and `:353–369`
  (single-repo) — pause writes `.daemon/PAUSED` (idempotent: "already paused"); resume
  removes it ("not paused" when absent). Pause parks dispatch without halting the daemon
  process or killing in-flight work (`pause-marker.ts:1–16`).
- **`--all` help precedent:** `logs` already documents `--all` at `cli.ts:168`.

## Scope

1. Register `pause` and `resume` as `daemon` sub-subcommands in `cli.ts` (help-only
   declarations, mirroring `start/stop/restart`), each documenting the `--all` fleet
   option and the bare-positional named-subset form.
2. Refresh `restart`'s description to mention respawn-in-place / session-preserving
   semantics (and its own `--all` / named-subset fleet form, which it already supports
   per `daemon-supervisor-cli.ts:222`).
3. Document `pause` / `resume` command forms in `README.md` and `src/conductor/README.md`
   (add the command forms next to the existing prose at ~line 659).

## Out of scope

- No change to dispatch, marker semantics, or supervisor behavior — those already work.
- No `--names` flag (does not exist; named subset is bare positionals).
- No new tests of pause/resume *behavior* (already covered); only help-surface assertions.
