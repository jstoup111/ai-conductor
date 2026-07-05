# Stories: Expose daemon pause/resume verbs in help + docs

**Track:** Technical (no PRD — see `.docs/track/expose-daemon-pause-resume-verbs.md`)
**Complexity:** Small (`.docs/complexity/expose-daemon-pause-resume-verbs.md`)
**Origin:** `jstoup111/ai-conductor#304` (Refs #215 / PR #296)
**Status:** Accepted

Traceability: this is a discoverability/documentation change for functionality already
shipped in PR #296. Each story carries concrete happy + negative Given/When/Then and a
measurable Done When. No verb *behavior* is changed — the acceptance criteria assert the
help-surface and docs only.

---

## Story: `daemon --help` documents pause and resume

As an operator, I want `conduct daemon --help` to list `pause` and `resume` alongside the
other management verbs, so that I can discover the flagship lifecycle verbs shipped in
PR #296 without reading source.

### Acceptance Criteria

#### Happy Path
- Given the daemon command help surface, when I run `conduct daemon --help` (or the
  recursive root `conduct --help`), then the output lists a `pause` sub-subcommand and a
  `resume` sub-subcommand, each with a one-line description of what it does.
- Given `pause` and `resume` support fleet dispatch, when I read their help, then each
  documents the `--all` option (act on every registered repo) and states that bare
  positional repo names select a named subset (e.g. `daemon pause repoA repoB`).
- Given `pause`'s help text, when I read it, then it conveys that pausing parks dispatch
  via a durable marker without halting the daemon or killing in-flight work, and that
  `resume` reverses it.

#### Negative Paths
- Given the fleet selector is bare positional names and **not** a `--names` flag (no such
  flag exists in `detectDaemonSupervisorCommand`), when the help documents the named-subset
  form, then it MUST NOT invent or reference a `--names` flag.
- Given the verbs are declared for help only (commander never dispatches them — dispatch is
  `detectDaemonSupervisorCommand` in `index.ts`), when the declarations are added, then they
  MUST NOT wire an `.action()` that would shadow the pre-boot supervisor dispatch or change
  runtime routing.

### Done When
- [ ] `conduct daemon --help` renders `pause` and `resume` with descriptions.
- [ ] Both document `--all` and the bare-positional named-subset form; neither mentions `--names`.
- [ ] No `.action()` handler is attached to the new declarations (parity with `start/stop/restart`).
- [ ] An integrity/CLI test asserts `pause` and `resume` appear in the daemon help output.

---

## Story: `restart` help reflects respawn-in-place semantics

As an operator, I want `restart`'s help text to describe its current respawn-in-place /
session-preserving behavior, so that the description is not misleadingly terse.

### Acceptance Criteria

#### Happy Path
- Given `restart`'s description at `cli.ts:191`, when I read `conduct daemon --help`, then
  the description conveys that restart respawns the daemon in place, preserving the tmux
  session (and, where available, scrollback) rather than tearing the session down.
- Given `restart` already supports fleet dispatch (`daemon-supervisor-cli.ts:222`), when I
  read its help, then it documents the `--all` / named-subset form consistently with
  `pause`/`resume`.

#### Negative Paths
- Given the refresh is a description-string change only, when it is applied, then it MUST NOT
  alter `restart`'s options, dispatch, or the queue-when-busy behavior (`RESTART-PENDING`).

### Done When
- [ ] `restart`'s help text mentions respawn-in-place / session preservation.
- [ ] `restart`'s help documents `--all` / named-subset fleet dispatch.
- [ ] No behavioral code path for `restart` is modified.

---

## Story: READMEs show pause/resume command forms

As an operator reading the docs, I want both `README.md` and `src/conductor/README.md` to
show the concrete `pause`/`resume` command forms, so that the docs match the shipped
capability (Docs-track-features rule).

### Acceptance Criteria

#### Happy Path
- Given `src/conductor/README.md` mentions pause semantics in prose (~line 659), when the
  docs are updated, then the concrete command forms appear next to that prose:
  `conduct daemon pause`, `conduct daemon resume`, `conduct daemon pause --all`,
  `conduct daemon pause <repoA> <repoB>` (and the resume equivalents).
- Given the top-level `README.md` command reference, when it is updated, then `pause` and
  `resume` are listed among the daemon management verbs with their fleet forms.

#### Negative Paths
- Given the documented forms, when a reader copies them, then every form MUST be a real,
  working invocation (no `--names`, no flags the parser does not accept). The `--all` flag
  and bare positional names are the only fleet selectors.
- Given the CHANGELOG rule for this repo, when the PR is opened, then a `## [Unreleased]`
  entry under `Changed` (or `Added`) records the help/docs surfacing (CI enforces this).

### Done When
- [ ] `src/conductor/README.md` shows all four command forms for pause and resume.
- [ ] `README.md` lists `pause`/`resume` in the daemon verb reference with `--all` / named-subset.
- [ ] Documented forms contain no non-existent flags (`--names` absent).
- [ ] `CHANGELOG.md` `[Unreleased]` gains a `Changed`/`Added` entry.
