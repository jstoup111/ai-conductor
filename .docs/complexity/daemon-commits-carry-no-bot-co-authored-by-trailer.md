# Complexity: daemon commits carry no bot co-author trailer under child isolation (#3377)

Tier: M

Rationale: the code change itself is small: one shared daemon-process bootstrap seam called from
two entry points (`daemon-cli.ts` and the private `executor-child` branch of `index.ts`), one new
closed `bot_co_author_skipped` reason raised by `refreshWorktreeCoAuthor` when no resolver is
installed at daemon dispatch, an updated wiring test, and one test that drives the child entry path.
It is Medium rather than Small because it amends an APPROVED ADR:
adr-2026-09-11-github-operation-ownership D10.1 caches the bot identity "for the daemon process",
and under child isolation each executor child resolves and caches its own identity. An amendment to
an approved decision needs the lightweight architecture review that Small skips. It also crosses a
process boundary (supervisor and executor child) and extends a persisted event variant, so
conflict-check and coherence-check are worth running. No new models, integrations, auth surface,
or persisted schema beyond the closed event reason. Expected 3 stories. Technical track: no PRD.

Approach selected (explore): a shared daemon-process bootstrap installs the resolver in every
daemon process that dispatches features. Rejected: an inline install in the child alone (leaves the
next per-process service free to drift between executors, the #3333 failure class), and passing a
supervisor-resolved result in the WorkOrder (changes the IPC shape and moves skip events off the
feature spine, with no confinement gain because the child already reads the bot token for `gh` writes).
